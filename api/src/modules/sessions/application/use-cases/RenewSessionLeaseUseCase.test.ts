import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RESUME_ATTEMPTS, RenewSessionLeaseUseCase } from './RenewSessionLeaseUseCase';
import { AcquireSessionLeaseUseCase } from './AcquireSessionLeaseUseCase';
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
    findLiveOwner: vi.fn(async () => null),
  };
}

function makeSockets(local: string[]): ISessionSocketControl {
  return {
    abortSession: vi.fn(async () => undefined),
    suspendSession: vi.fn(async () => undefined),
    resumeSession: vi.fn(async () => true),
    closeAllSockets: vi.fn(async () => undefined),
    listLocalSessionIds: vi.fn(() => [...local]),
  };
}

function setup(renew: ISessionLeaseRepository['renew'], local = ['s1', 's2']) {
  const repo = makeRepo(renew);
  const sockets = makeSockets(local);
  const ledger = new SessionLeaseLedger();
  for (const id of ['s1', 's2']) ledger.markOk(id, new Date(T0));
  const log = { warn: vi.fn(), error: vi.fn() };
  const now = () => new Date(Date.now());
  const acquirer = new AcquireSessionLeaseUseCase(repo, ledger, 'w1', now, { warn: vi.fn() });
  const uc = new RenewSessionLeaseUseCase(repo, ledger, sockets, acquirer, 'w1', now, log);
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

  it('zero linhas → derruba todas (abort descarta, sem suspender nem marcar fence)', async () => {
    const { ledger, sockets, uc } = setup(async () => []);
    await uc.execute();
    expect(sockets.abortSession).toHaveBeenCalledTimes(2);
    expect(sockets.suspendSession).not.toHaveBeenCalled();
    expect(ledger.ids()).toEqual([]);
    expect(ledger.fencedIds()).toEqual([]);
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
    expect(sockets.abortSession).not.toHaveBeenCalled();
    expect(sockets.suspendSession).toHaveBeenCalledTimes(2);
    expect(ledger.ids()).toEqual([]);
    expect(ledger.fencedIds().sort()).toEqual(['s1', 's2']);
  });

  it('timeout do renew vale como falha: fence checado depois da espera', async () => {
    const { ledger, sockets, log, uc } = setup(() => new Promise<string[]>(() => undefined));
    vi.setSystemTime(T0 + 52_000);
    const run = uc.execute();
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_TIMEOUT_MS);
    await run;
    expect(log.warn).toHaveBeenCalled();
    expect(sockets.abortSession).not.toHaveBeenCalled();
    expect(sockets.suspendSession).toHaveBeenCalledTimes(2);
    expect(ledger.ids()).toEqual([]);
    expect(ledger.fencedIds().sort()).toEqual(['s1', 's2']);
  });

  it('timeout com fence ainda válido mantém o socket', async () => {
    const { ledger, sockets, uc } = setup(() => new Promise<string[]>(() => undefined));
    vi.setSystemTime(T0 + 20_000);
    const run = uc.execute();
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_TIMEOUT_MS);
    await run;
    expect(sockets.abortSession).not.toHaveBeenCalled();
    expect(sockets.suspendSession).not.toHaveBeenCalled();
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

  describe('fence por erro de banco', () => {
    function downThenUp() {
      let down = true;
      const env = setup(async (ids) => {
        if (down) throw new Error('db down');
        return [...ids];
      });
      return { ...env, up: () => { down = false; } };
    }

    it('erro de banco 2 rodadas → suspende (preserva chaves) sem abortar', async () => {
      const { sockets, ledger, uc } = downThenUp();
      vi.setSystemTime(T0 + 20_000);
      await uc.execute();
      vi.setSystemTime(T0 + 40_000);
      await uc.execute();
      expect(sockets.suspendSession).not.toHaveBeenCalled();
      vi.setSystemTime(T0 + 60_000);
      await uc.execute();
      expect(sockets.suspendSession).toHaveBeenCalledTimes(2);
      expect(sockets.abortSession).not.toHaveBeenCalled();
      expect(ledger.fencedIds().sort()).toEqual(['s1', 's2']);
    });

    it('banco ainda fora: suspensa fica marcada e não reabre', async () => {
      const { sockets, ledger, repo, uc } = downThenUp();
      vi.setSystemTime(T0 + 56_000);
      await uc.execute(); // suspende antes do banco
      vi.mocked(sockets.listLocalSessionIds).mockReturnValue([]);
      await uc.execute(); // sonda falha
      expect(repo.renew).toHaveBeenLastCalledWith(['s1', 's2'], 'w1', LEASE_TTL_MS);
      expect(sockets.resumeSession).not.toHaveBeenCalled();
      expect(ledger.fencedIds().sort()).toEqual(['s1', 's2']);
    });

    async function suspendedBothThenUp() {
      const env = downThenUp();
      vi.setSystemTime(T0 + 56_000);
      await env.uc.execute(); // suspende s1/s2
      vi.mocked(env.sockets.listLocalSessionIds).mockReturnValue([]);
      env.up();
      return env;
    }

    it('renovação volta → adquire (sem release) e reabre via resume; marca limpa', async () => {
      const { sockets, ledger, repo, uc } = await suspendedBothThenUp();
      await uc.execute();
      expect(repo.release).not.toHaveBeenCalled();
      expect(repo.tryAcquire).toHaveBeenCalledWith('s1', 'w1', LEASE_TTL_MS);
      expect(repo.tryAcquire).toHaveBeenCalledWith('s2', 'w1', LEASE_TTL_MS);
      expect(sockets.resumeSession).toHaveBeenCalledWith('s1');
      expect(sockets.resumeSession).toHaveBeenCalledWith('s2');
      expect(ledger.fencedIds()).toEqual([]);
    });

    it('lease de outro processo (held) → limpa a marca sem chamar resume', async () => {
      const { sockets, ledger, repo, uc } = await suspendedBothThenUp();
      vi.mocked(repo.tryAcquire).mockResolvedValue(false);
      await uc.execute();
      expect(sockets.resumeSession).not.toHaveBeenCalled();
      expect(ledger.fencedIds()).toEqual([]);
      expect(sockets.abortSession).not.toHaveBeenCalled();
    });

    it('resume devolve false → limpa a marca', async () => {
      const { sockets, ledger, uc } = await suspendedBothThenUp();
      vi.mocked(sockets.resumeSession).mockResolvedValue(false);
      await uc.execute();
      expect(ledger.fencedIds()).toEqual([]);
    });

    it('erro transitório (acquire no banco ou resume) mantém a marca e tenta de novo', async () => {
      const { sockets, ledger, repo, uc } = await suspendedBothThenUp();
      vi.mocked(repo.tryAcquire).mockImplementation(async (id) => {
        if (id === 's1') throw new Error('db flaky');
        return true;
      });
      vi.mocked(sockets.resumeSession).mockRejectedValueOnce(new Error('fetchLatestBaileysVersion'));
      await expect(uc.execute()).resolves.toBeUndefined();
      expect(sockets.resumeSession).toHaveBeenCalledExactlyOnceWith('s2');
      expect(ledger.fencedIds().sort()).toEqual(['s1', 's2']);
      expect(ledger.fenceAttempts('s1')).toBe(1);
      expect(ledger.fenceAttempts('s2')).toBe(1);
      expect(ledger.ids()).toEqual([]);

      vi.mocked(repo.tryAcquire).mockResolvedValue(true);
      await uc.execute();
      expect(sockets.resumeSession).toHaveBeenCalledWith('s1');
      expect(vi.mocked(sockets.resumeSession).mock.calls.filter(([id]) => id === 's2')).toHaveLength(2);
      expect(ledger.fencedIds()).toEqual([]);
      expect(repo.release).not.toHaveBeenCalled();
    });

    it(`limite de ${MAX_RESUME_ATTEMPTS} tentativas → limpa a marca e loga error`, async () => {
      const { sockets, ledger, uc, log } = await suspendedBothThenUp();
      vi.mocked(sockets.resumeSession).mockRejectedValue(new Error('auth.load'));
      for (let i = 1; i < MAX_RESUME_ATTEMPTS; i++) {
        await uc.execute();
        expect(ledger.fenceAttempts('s1')).toBe(i);
      }
      expect(log.error).not.toHaveBeenCalled();
      await uc.execute();
      expect(sockets.resumeSession).toHaveBeenCalledTimes(MAX_RESUME_ATTEMPTS * 2);
      expect(ledger.fencedIds()).toEqual([]);
      expect(ledger.ids()).toEqual([]);
      expect(log.error).toHaveBeenCalledTimes(2);
      await uc.execute();
      expect(sockets.resumeSession).toHaveBeenCalledTimes(MAX_RESUME_ATTEMPTS * 2);
    });

    it('suspensa que já tem socket de novo (reconexão manual) não é reaberta', async () => {
      const { sockets, ledger, repo, uc, up } = downThenUp();
      vi.setSystemTime(T0 + 56_000);
      await uc.execute();
      up();
      await uc.execute(); // listLocal ainda devolve s1/s2
      expect(sockets.resumeSession).not.toHaveBeenCalled();
      expect(repo.release).not.toHaveBeenCalled();
      expect(ledger.fencedIds()).toEqual([]);
    });

    it('lease perdido de sessão viva continua abortando enquanto a suspensa reabre', async () => {
      const { sockets, ledger, uc } = setup(async () => []);
      ledger.markFenced('s9');
      await uc.execute();
      expect(sockets.abortSession).toHaveBeenCalledTimes(2);
      expect(sockets.resumeSession).toHaveBeenCalledExactlyOnceWith('s9');
      expect(ledger.fencedIds()).toEqual([]);
    });
  });
});
