import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RenewSessionLeaseUseCase } from './RenewSessionLeaseUseCase';
import { SessionLeaseLedger } from '../services/SessionLeaseLedger';
import { LEASE_RENEW_TIMEOUT_MS, LEASE_TTL_MS } from '../../domain/services/sessionLeasePolicy';
import type { ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';
import type { ISessionSocketControl } from '../../../messaging/domain/contracts/ISessionSocketControl';

const T0 = new Date('2026-11-04T12:00:00Z').getTime();

function makeRepo(renew: ISessionLeaseRepository['renew']): ISessionLeaseRepository {
  return {
    tryAcquire: vi.fn(async () => true),
    renew: vi.fn(renew),
    release: vi.fn(async () => undefined),
    releaseAllOwned: vi.fn(async () => 0),
  };
}

function makeSockets(local: string[]): ISessionSocketControl {
  return {
    abortSession: vi.fn(async () => undefined),
    closeAllSockets: vi.fn(async () => undefined),
    listLocalSessionIds: vi.fn(() => [...local]),
  };
}

function setup(renew: ISessionLeaseRepository['renew'], local = ['s1', 's2']) {
  const repo = makeRepo(renew);
  const sockets = makeSockets(local);
  const ledger = new SessionLeaseLedger();
  for (const id of ['s1', 's2']) ledger.markOk(id, new Date(T0));
  const log = { warn: vi.fn() };
  const uc = new RenewSessionLeaseUseCase(repo, ledger, sockets, 'w1', () => new Date(Date.now()), log);
  return { repo, sockets, ledger, log, uc };
}

describe('RenewSessionLeaseUseCase', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('renova razão ∩ sockets locais com workerId/TTL e atualiza lastOk', async () => {
    const { repo, ledger, sockets, uc } = setup(async (ids) => [...ids]);
    vi.setSystemTime(T0 + 20_000);
    await uc.execute();
    expect(repo.renew).toHaveBeenCalledWith(['s1', 's2'], 'w1', LEASE_TTL_MS);
    expect(ledger.lastOk('s1')).toEqual(new Date(T0 + 20_000));
    expect(sockets.abortSession).not.toHaveBeenCalled();
  });

  it('sessão no razão sem socket local sai do razão sem renovar nem derrubar', async () => {
    const { repo, ledger, sockets, uc } = setup(async (ids) => [...ids], ['s1']);
    await uc.execute();
    expect(repo.renew).toHaveBeenCalledWith(['s1'], 'w1', LEASE_TTL_MS);
    expect(ledger.ids()).toEqual(['s1']);
    expect(sockets.abortSession).not.toHaveBeenCalled();
  });

  it('socket local fora do razão não é renovado', async () => {
    const { repo, uc } = setup(async (ids) => [...ids], ['s1', 's2', 's3']);
    await uc.execute();
    expect(repo.renew).toHaveBeenCalledWith(['s1', 's2'], 'w1', LEASE_TTL_MS);
  });

  it('perdeu (id fora do retorno) → abort imediato e sai do razão', async () => {
    const { ledger, sockets, uc } = setup(async () => ['s2']);
    vi.setSystemTime(T0 + 20_000);
    await uc.execute();
    expect(sockets.abortSession).toHaveBeenCalledExactlyOnceWith('s1');
    expect(ledger.ids()).toEqual(['s2']);
  });

  it('zero linhas → derruba todas', async () => {
    const { ledger, sockets, uc } = setup(async () => []);
    await uc.execute();
    expect(sockets.abortSession).toHaveBeenCalledTimes(2);
    expect(ledger.ids()).toEqual([]);
  });

  it('banco fora há 54 s → mantém; 56 s → derruba (fence antes do banco)', async () => {
    const { repo, ledger, sockets, uc } = setup(async () => {
      throw new Error('db down');
    });
    vi.setSystemTime(T0 + 54_000);
    await uc.execute();
    expect(sockets.abortSession).not.toHaveBeenCalled();
    expect(ledger.ids()).toEqual(['s1', 's2']);
    expect(repo.renew).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + 56_000);
    await uc.execute();
    expect(repo.renew).toHaveBeenCalledTimes(1);
    expect(sockets.abortSession).toHaveBeenCalledTimes(2);
    expect(ledger.ids()).toEqual([]);
  });

  it('timeout do renew vale como falha: fence checado depois da espera', async () => {
    const { ledger, sockets, log, uc } = setup(() => new Promise<string[]>(() => undefined));
    vi.setSystemTime(T0 + 52_000);
    const run = uc.execute();
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_TIMEOUT_MS);
    await run;
    expect(log.warn).toHaveBeenCalled();
    expect(sockets.abortSession).toHaveBeenCalledTimes(2);
    expect(ledger.ids()).toEqual([]);
  });

  it('timeout com fence ainda válido mantém o socket', async () => {
    const { ledger, sockets, uc } = setup(() => new Promise<string[]>(() => undefined));
    vi.setSystemTime(T0 + 20_000);
    const run = uc.execute();
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_TIMEOUT_MS);
    await run;
    expect(sockets.abortSession).not.toHaveBeenCalled();
    expect(ledger.lastOk('s1')).toEqual(new Date(T0));
  });

  it('erro no abort é logado e a sessão sai do razão mesmo assim', async () => {
    const { ledger, sockets, log, uc } = setup(async () => []);
    vi.mocked(sockets.abortSession).mockRejectedValueOnce(new Error('boom'));
    await expect(uc.execute()).resolves.toBeUndefined();
    expect(ledger.ids()).toEqual([]);
    expect(log.warn).toHaveBeenCalled();
  });

  it('razão vazio não chama o banco', async () => {
    const { repo, uc } = setup(async (ids) => [...ids], []);
    await uc.execute();
    expect(repo.renew).not.toHaveBeenCalled();
  });
});
