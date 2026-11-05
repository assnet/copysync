import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionLeaseKeeper } from './SessionLeaseKeeper';
import { LEASE_RENEW_INTERVAL_MS } from '../../domain/services/sessionLeasePolicy';
import { MAX_RESUME_ATTEMPTS, RenewSessionLeaseUseCase } from '../use-cases/RenewSessionLeaseUseCase';
import { SessionLeaseLedger } from './SessionLeaseLedger';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('SessionLeaseKeeper', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('roda a cada 20 s depois do start', async () => {
    const execute = vi.fn(async () => undefined);
    const keeper = new SessionLeaseKeeper({ execute }, undefined, { warn: vi.fn() });
    keeper.start();
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS - 1);
    expect(execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS);
    expect(execute).toHaveBeenCalledTimes(2);
    await keeper.stop();
  });

  it('não sobrepõe ticks: o próximo só agenda depois que o atual termina', async () => {
    const d = deferred();
    const execute = vi.fn(() => d.promise);
    const keeper = new SessionLeaseKeeper({ execute }, 1_000, { warn: vi.fn() });
    keeper.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(execute).toHaveBeenCalledTimes(1);
    d.resolve();
    await vi.advanceTimersByTimeAsync(999);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledTimes(2);
    await keeper.stop();
  });

  it('stop impede novo tick', async () => {
    const execute = vi.fn(async () => undefined);
    const keeper = new SessionLeaseKeeper({ execute }, 1_000, { warn: vi.fn() });
    keeper.start();
    await keeper.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(execute).not.toHaveBeenCalled();
  });

  it('stop espera o tick em curso e não agenda outro', async () => {
    const d = deferred();
    const execute = vi.fn(() => d.promise);
    const keeper = new SessionLeaseKeeper({ execute }, 1_000, { warn: vi.fn() });
    keeper.start();
    await vi.advanceTimersByTimeAsync(1_000);
    let stopped = false;
    const stopping = keeper.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    d.resolve();
    await stopping;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('erro no tick é logado e o keeper segue', async () => {
    const log = { warn: vi.fn() };
    const execute = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    const keeper = new SessionLeaseKeeper({ execute }, 1_000, log);
    keeper.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(2);
    await keeper.stop();
  });

  it('start duplo não cria dois agendamentos', async () => {
    const execute = vi.fn(async () => undefined);
    const keeper = new SessionLeaseKeeper({ execute }, 1_000, { warn: vi.fn() });
    keeper.start();
    keeper.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(execute).toHaveBeenCalledTimes(1);
    await keeper.stop();
  });

  it('(6) retomada lenta sai fora do tick: renovação segue no ritmo e a sessão não ganha 2ª retomada', async () => {
    const slow = deferred();
    const execute = vi.fn(async () => ['s9', 's8']);
    const resume = vi.fn((id: string) => (id === 's9' ? slow.promise : Promise.resolve()));
    const keeper = new SessionLeaseKeeper({ execute, resume }, 1_000, { warn: vi.fn() });
    keeper.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(execute).toHaveBeenCalledTimes(5);
    expect(resume.mock.calls.filter(([id]) => id === 's9')).toHaveLength(1);
    expect(resume.mock.calls.filter(([id]) => id === 's8')).toHaveLength(5);
    slow.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resume.mock.calls.filter(([id]) => id === 's9')).toHaveLength(2);
    await keeper.stop();
  });

  it('erro na retomada é logado e não derruba o keeper', async () => {
    const log = { warn: vi.fn() };
    const execute = vi.fn(async () => ['s1']);
    const resume = vi.fn(async () => { throw new Error('x'); });
    const keeper = new SessionLeaseKeeper({ execute, resume }, 1_000, log);
    keeper.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(resume).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(2);
    await keeper.stop();
  });

  it('stop espera a retomada em curso no máximo um intervalo', async () => {
    const never = deferred();
    const execute = vi.fn(async () => ['s1']);
    const keeper = new SessionLeaseKeeper({ execute, resume: () => never.promise }, 1_000, { warn: vi.fn() });
    keeper.start();
    await vi.advanceTimersByTimeAsync(1_000);
    let stopped = false;
    const stopping = keeper.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(stopped).toBe(true);
  });

  it('retomada pendurada (banco mudo) libera o slot no prazo e a sessão é tentada de novo até desistir', async () => {
    const ledger = new SessionLeaseLedger();
    ledger.markFenced('s1');
    const sockets = {
      abortSession: vi.fn(async () => undefined),
      suspendSession: vi.fn(async () => undefined),
      resumeSession: vi.fn(() => new Promise<never>(() => undefined)), // acquire/build nunca assentam
      forgetSuspension: vi.fn(async () => 't1'),
      adoptSession: vi.fn(async () => 'opened' as const),
      closeAllSockets: vi.fn(async () => undefined),
      listLocalSessionIds: vi.fn(() => [] as string[]),
    };
    const repo = {
      tryAcquire: vi.fn(async () => true),
      renew: vi.fn(async (ids: readonly string[]) => [...ids]),
      release: vi.fn(async () => undefined),
      releaseAllOwned: vi.fn(async () => 0),
      findLiveOwner: vi.fn(async () => null),
    };
    const status = { markDisconnectedIfNoLiveLease: vi.fn(async () => true) };
    const log = { warn: vi.fn(), error: vi.fn() };
    const uc = new RenewSessionLeaseUseCase(repo, ledger, sockets, status, 'w1', () => new Date(), log, 500);
    const keeper = new SessionLeaseKeeper(uc, 1_000, { warn: vi.fn() });
    keeper.start();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sockets.resumeSession).toHaveBeenCalledTimes(1);
    expect(ledger.fenceAttempts('s1')).toBe(1); // contou e soltou o slot
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets.resumeSession).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000 * MAX_RESUME_ATTEMPTS);
    expect(sockets.resumeSession).toHaveBeenCalledTimes(MAX_RESUME_ATTEMPTS);
    expect(status.markDisconnectedIfNoLiveLease).toHaveBeenCalledWith('s1', 't1');
    let stopped = false;
    const stopping = keeper.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    await stopping;
    expect(stopped).toBe(true); // nenhum slot preso segura o stop
  });
});
