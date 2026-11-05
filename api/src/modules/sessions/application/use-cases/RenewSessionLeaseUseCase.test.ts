import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RESUME_ATTEMPTS, RenewSessionLeaseUseCase } from './RenewSessionLeaseUseCase';
import { AcquireSessionLeaseUseCase } from './AcquireSessionLeaseUseCase';
import { SessionLeaseLedger } from '../services/SessionLeaseLedger';
import { LEASE_RENEW_TIMEOUT_MS, LEASE_TTL_MS } from '../../domain/services/sessionLeasePolicy';
import type { ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';
import type { ISessionSocketControl, SessionResumeResult } from '../../../messaging/domain/contracts/ISessionSocketControl';

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
    resumeSession: vi.fn(async (): Promise<SessionResumeResult> => 'resumed'),
    forgetSuspension: vi.fn(async (): Promise<string | null> => 't1'),
    closeAllSockets: vi.fn(async () => undefined),
    listLocalSessionIds: vi.fn(() => [...local]),
  };
}

const RESUME_TIMEOUT_MS = 20_000;

function setup(renew: ISessionLeaseRepository['renew'], local = ['s1', 's2']) {
  const repo = makeRepo(renew);
  const sockets = makeSockets(local);
  const ledger = new SessionLeaseLedger();
  for (const id of ['s1', 's2']) ledger.markOk(id, new Date(T0));
  const log = { warn: vi.fn(), error: vi.fn() };
  const now = () => new Date(Date.now());
  // Como o adapter: o acquire tipado fica dentro do resume (held → 'held', erro de banco → lança)
  const acquirer = new AcquireSessionLeaseUseCase(repo, ledger, 'w1', now, { warn: vi.fn() });
  vi.mocked(sockets.resumeSession).mockImplementation(async (id) => {
    const lease = await acquirer.acquireResult(id);
    if (lease === 'held') return 'held';
    if (lease === 'error') throw new Error('lease acquire failed');
    return 'resumed';
  });
  const status = { markDisconnectedIfNoLiveLease: vi.fn(async () => true) };
  const uc = new RenewSessionLeaseUseCase(repo, ledger, sockets, status, 'w1', now, log, RESUME_TIMEOUT_MS);
  /** Uma rodada + as retomadas que ela devolve (o keeper faz isso fora do tick). */
  const round = async (): Promise<void> => {
    for (const id of await uc.execute()) await uc.resume(id);
  };
  return { repo, sockets, ledger, log, uc, status, round };
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
    await expect(uc.execute()).resolves.toEqual([]);
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

    it('execute só devolve as suspensas (não reabre no tick); resume reabre sem release; marca limpa', async () => {
      const { sockets, ledger, repo, uc } = await suspendedBothThenUp();
      expect((await uc.execute()).sort()).toEqual(['s1', 's2']);
      expect(sockets.resumeSession).not.toHaveBeenCalled();
      await uc.resume('s1');
      await uc.resume('s2');
      expect(repo.release).not.toHaveBeenCalled();
      expect(repo.tryAcquire).toHaveBeenCalledWith('s1', 'w1', LEASE_TTL_MS);
      expect(sockets.resumeSession).toHaveBeenCalledWith('s2');
      expect(ledger.fencedIds()).toEqual([]);
      expect(sockets.forgetSuspension).not.toHaveBeenCalled();
    });

    it('banco ainda fora: execute não devolve suspensas', async () => {
      const { uc, repo, sockets } = await suspendedBothThenUp();
      vi.mocked(repo.renew).mockRejectedValue(new Error('db down'));
      expect(await uc.execute()).toEqual([]);
      expect(sockets.resumeSession).not.toHaveBeenCalled();
    });

    it('(1) acquire com erro de banco no resume → mantém a marca e tenta de novo na próxima rodada', async () => {
      const { sockets, ledger, repo, round } = await suspendedBothThenUp();
      vi.mocked(repo.tryAcquire).mockImplementation(async (id) => {
        if (id === 's1') throw new Error('db flaky');
        return true;
      });
      await round();
      expect(ledger.fencedIds()).toEqual(['s1']);
      expect(ledger.fenceAttempts('s1')).toBe(1);
      expect(sockets.forgetSuspension).not.toHaveBeenCalled();

      vi.mocked(repo.tryAcquire).mockResolvedValue(true);
      await round();
      expect(vi.mocked(sockets.resumeSession).mock.calls.filter(([id]) => id === 's1')).toHaveLength(2);
      expect(ledger.fencedIds()).toEqual([]);
      expect(ledger.ids()).toContain('s1');
    });

    it('(2) held → limpa a marca e esquece a suspensão no adapter', async () => {
      const { sockets, ledger, repo, round } = await suspendedBothThenUp();
      vi.mocked(repo.tryAcquire).mockResolvedValue(false);
      await round();
      expect(ledger.fencedIds()).toEqual([]);
      expect(sockets.forgetSuspension).toHaveBeenCalledWith('s1');
      expect(sockets.forgetSuspension).toHaveBeenCalledWith('s2');
      expect(sockets.abortSession).not.toHaveBeenCalled();
    });

    it('(3) throw no reopen → mantém a marca (o adapter mantém a dele: sem forgetSuspension)', async () => {
      const { sockets, ledger, round } = await suspendedBothThenUp();
      vi.mocked(sockets.resumeSession).mockRejectedValue(new Error('fetchLatestBaileysVersion'));
      await round();
      expect(ledger.fencedIds().sort()).toEqual(['s1', 's2']);
      expect(ledger.fenceAttempts('s2')).toBe(1);
      expect(sockets.forgetSuspension).not.toHaveBeenCalled();
    });

    it('gone → limpa a marca sem forgetSuspension', async () => {
      const { sockets, ledger, round } = await suspendedBothThenUp();
      vi.mocked(sockets.resumeSession).mockResolvedValue('gone');
      await round();
      expect(ledger.fencedIds()).toEqual([]);
      expect(sockets.forgetSuspension).not.toHaveBeenCalled();
    });

    it(`(4) limite de ${MAX_RESUME_ATTEMPTS} tentativas → DISCONNECTED gravado, lease solto e mapas limpos`, async () => {
      const { sockets, ledger, log, status, repo, round } = await suspendedBothThenUp();
      vi.mocked(sockets.resumeSession).mockRejectedValue(new Error('auth.load'));
      for (let i = 1; i < MAX_RESUME_ATTEMPTS; i++) {
        await round();
        expect(ledger.fenceAttempts('s1')).toBe(i);
      }
      expect(log.error).not.toHaveBeenCalled();
      await round();
      expect(sockets.resumeSession).toHaveBeenCalledTimes(MAX_RESUME_ATTEMPTS * 2);
      expect(sockets.forgetSuspension).toHaveBeenCalledWith('s1');
      expect(repo.release).toHaveBeenCalledWith('s1', 'w1');
      expect(status.markDisconnectedIfNoLiveLease).toHaveBeenCalledWith('s1', 't1');
      expect(status.markDisconnectedIfNoLiveLease).toHaveBeenCalledWith('s2', 't1');
      expect(ledger.fencedIds()).toEqual([]);
      expect(ledger.ids()).toEqual([]);
      expect(log.error).toHaveBeenCalledTimes(2);
      await round();
      expect(sockets.resumeSession).toHaveBeenCalledTimes(MAX_RESUME_ATTEMPTS * 2);
    });

    it('repo que nunca responde: resume assenta no prazo, conta a tentativa e não espera a reabertura', async () => {
      const { sockets, ledger, repo, uc } = await suspendedBothThenUp();
      vi.mocked(repo.tryAcquire).mockImplementation(() => new Promise<boolean>(() => undefined));
      await uc.execute();
      let settled = false;
      const p = uc.resume('s1').then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(settled).toBe(true);
      expect(ledger.fenceAttempts('s1')).toBe(1);
      expect(ledger.isFenced('s1')).toBe(true);
      expect(sockets.forgetSuspension).not.toHaveBeenCalled();
    });

    it(`repo que nunca responde: desistência após ${MAX_RESUME_ATTEMPTS} prazos grava DISCONNECTED`, async () => {
      const { sockets, ledger, repo, status, uc } = await suspendedBothThenUp();
      vi.mocked(repo.tryAcquire).mockImplementation(() => new Promise<boolean>(() => undefined));
      for (let i = 1; i <= MAX_RESUME_ATTEMPTS; i++) {
        await uc.execute();
        const p = uc.resume('s1');
        await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);
        await p;
      }
      expect(status.markDisconnectedIfNoLiveLease).toHaveBeenCalledWith('s1', 't1');
      expect(sockets.abortSession).toHaveBeenCalledWith('s1');
      expect(ledger.isFenced('s1')).toBe(false);
    });

    it('reabertura que assenta depois do prazo não muda a tentativa já contada', async () => {
      const { sockets, ledger, uc } = await suspendedBothThenUp();
      let finish!: (r: SessionResumeResult) => void;
      vi.mocked(sockets.resumeSession).mockImplementationOnce(() => new Promise((r) => { finish = r; }));
      await uc.execute();
      const p = uc.resume('s1');
      await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);
      await p;
      finish('resumed');
      await vi.advanceTimersByTimeAsync(0);
      expect(ledger.fenceAttempts('s1')).toBe(1);
    });

    it('rejeição tardia da reabertura (depois do prazo) é descartada', async () => {
      const { sockets, uc } = await suspendedBothThenUp();
      let fail!: (e: Error) => void;
      vi.mocked(sockets.resumeSession).mockImplementationOnce(() => new Promise((_r, rej) => { fail = rej; }));
      await uc.execute();
      const p = uc.resume('s1');
      await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS);
      await p;
      fail(new Error('tarde'));
      await vi.advanceTimersByTimeAsync(0); // sem unhandled rejection (vitest falharia)
    });

    it('desistência aborta antes de soltar o lease', async () => {
      const { sockets, repo, status, round } = await suspendedBothThenUp();
      vi.mocked(sockets.resumeSession).mockRejectedValue(new Error('auth.load'));
      const order: string[] = [];
      vi.mocked(sockets.forgetSuspension).mockImplementation(async (id) => { order.push(`forget:${id}`); return 't1'; });
      vi.mocked(sockets.abortSession).mockImplementation(async (id) => { order.push(`abort:${id}`); });
      vi.mocked(repo.release).mockImplementation(async (id) => { order.push(`release:${id}`); });
      vi.mocked(status.markDisconnectedIfNoLiveLease as (id: string) => Promise<boolean>).mockImplementation(async (id: string) => { order.push(`status:${id}`); return true; });
      for (let i = 0; i < MAX_RESUME_ATTEMPTS; i++) await round();
      expect(order.filter((o) => o.endsWith(':s1'))).toEqual(['forget:s1', 'abort:s1', 'release:s1', 'status:s1']);
    });

    it('falha no abort da desistência é logada e o lease é solto mesmo assim', async () => {
      const { sockets, repo, status, log, round } = await suspendedBothThenUp();
      vi.mocked(sockets.resumeSession).mockRejectedValue(new Error('auth.load'));
      vi.mocked(sockets.abortSession).mockRejectedValue(new Error('abort falhou'));
      for (let i = 0; i < MAX_RESUME_ATTEMPTS; i++) await round();
      expect(repo.release).toHaveBeenCalledWith('s1', 'w1');
      expect(status.markDisconnectedIfNoLiveLease).toHaveBeenCalledWith('s1', 't1');
      expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }), expect.stringContaining('desistência'));
    });

    it('socket local de suspensa sem lease no razão (retomada tardia) entra na sonda e volta ao razão', async () => {
      const { ledger, repo, uc } = setup(async (ids) => [...ids], ['s1']);
      ledger.drop('s2');
      ledger.markFenced('s1', 3);
      expect(await uc.execute()).toEqual([]);
      expect(repo.renew).toHaveBeenCalledWith(['s1'], 'w1', LEASE_TTL_MS);
      expect(ledger.ids()).toEqual(['s1']);
      expect(ledger.fencedIds()).toEqual([]);
    });

    it('socket local sem lease no razão e sem prova na sonda → abortado', async () => {
      const { ledger, sockets, uc } = setup(async () => [], ['s1']);
      ledger.drop('s2');
      ledger.markFenced('s1');
      await uc.execute();
      expect(sockets.abortSession).toHaveBeenCalledExactlyOnceWith('s1');
    });

    it('suspensa que já tem socket de novo (reconexão manual) não é reaberta', async () => {
      const { sockets, ledger, repo, uc, up } = downThenUp();
      vi.setSystemTime(T0 + 56_000);
      await uc.execute();
      up();
      expect(await uc.execute()).toEqual([]); // listLocal ainda devolve s1/s2
      expect(sockets.resumeSession).not.toHaveBeenCalled();
      expect(repo.release).not.toHaveBeenCalled();
      expect(ledger.fencedIds()).toEqual([]);
    });

    it('lease perdido de sessão viva continua abortando enquanto a suspensa é devolvida para reabrir', async () => {
      const { sockets, ledger, uc } = setup(async () => []);
      ledger.markFenced('s9');
      expect(await uc.execute()).toEqual(['s9']);
      expect(sockets.abortSession).toHaveBeenCalledTimes(2);
      await uc.resume('s9');
      expect(sockets.resumeSession).toHaveBeenCalledExactlyOnceWith('s9');
      expect(ledger.fencedIds()).toEqual([]);
    });
  });
});
