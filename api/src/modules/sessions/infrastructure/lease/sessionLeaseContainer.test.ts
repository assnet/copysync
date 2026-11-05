import { describe, it, expect, vi } from 'vitest';

vi.mock('../repositories/PrismaSessionLeaseRepository', () => ({
  PrismaSessionLeaseRepository: class {
    tryAcquire = vi.fn();
    renew = vi.fn();
    release = vi.fn();
    releaseAllOwned = vi.fn();
    findLiveOwner = vi.fn();
  },
}));
vi.mock('../repositories/PrismaSessionRepository', () => ({
  PrismaSessionRepository: class {
    markDisconnectedIfNoLiveLease = vi.fn();
  },
}));
vi.mock('../../../../shared/config/workerIdentity', () => ({ currentWorkerId: () => 'worker-test' }));
const adoptionCfg = vi.hoisted(() => ({ enabled: false, maxSessions: 1, shard: null as string | null }));
vi.mock('../../../../shared/config/workerAdoption', () => ({ workerAdoptionConfig: () => adoptionCfg }));

import { buildSessionLeaseContainer, sessionLeaseContainer } from './sessionLeaseContainer';
import type { ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';

function fakeRepo(): ISessionLeaseRepository {
  return {
    tryAcquire: vi.fn().mockResolvedValue(true),
    renew: vi.fn().mockResolvedValue([]),
    release: vi.fn().mockResolvedValue(undefined),
    releaseAllOwned: vi.fn().mockResolvedValue(0),
    findLiveOwner: vi.fn().mockResolvedValue(null),
  } as unknown as ISessionLeaseRepository;
}

describe('sessionLeaseContainer', () => {
  it('devolve as mesmas instâncias em chamadas repetidas', () => {
    const a = sessionLeaseContainer();
    const b = sessionLeaseContainer();
    expect(b).toBe(a);
    expect(b.acquire).toBe(a.acquire);
    expect(b.release).toBe(a.release);
    expect(b.keeper).toBe(a.keeper);
    expect(b.ledger).toBe(a.ledger);
    expect(a.workerId).toBe('worker-test');
  });

  it('gate, renovação e release compartilham o mesmo razão', async () => {
    const repo = fakeRepo();
    const c = buildSessionLeaseContainer(repo, 'w1');
    expect(await c.acquire.acquire('s1')).toBe(true);
    expect(repo.tryAcquire).toHaveBeenCalledWith('s1', 'w1', expect.any(Number));
    expect(c.ledger.ids()).toEqual(['s1']);
    await c.release.execute('s1');
    expect(repo.release).toHaveBeenCalledWith('s1', 'w1');
    expect(c.ledger.ids()).toEqual([]);
  });

  it('gate das engines: acquire e release usam o mesmo razão', async () => {
    const repo = fakeRepo();
    const c = buildSessionLeaseContainer(repo, 'w1');
    expect(await c.gate.acquire('s1')).toBe(true);
    expect(c.ledger.ids()).toEqual(['s1']);
    await c.gate.release!('s1');
    expect(repo.release).toHaveBeenCalledWith('s1', 'w1');
    expect(c.ledger.ids()).toEqual([]);
  });

  it('renovação sem socket ligado não faz nada; ligado, usa o controle de socket', async () => {
    const repo = fakeRepo();
    const c = buildSessionLeaseContainer(repo, 'w1');
    await c.acquire.acquire('s1');
    await c.renew.execute();
    expect(repo.renew).not.toHaveBeenCalled();
    expect(c.ledger.ids()).toEqual([]); // sem socket local: sai do razão

    await c.acquire.acquire('s1');
    const abortSession = vi.fn().mockResolvedValue(undefined);
    c.bindSocketControl({
      abortSession, suspendSession: vi.fn(), resumeSession: vi.fn(), forgetSuspension: vi.fn(), closeAllSockets: vi.fn(), listLocalSessionIds: () => ['s1'],
    });
    await c.renew.execute(); // renew devolve [] = lease perdido → derruba
    expect(repo.renew).toHaveBeenCalledWith(['s1'], 'w1', expect.any(Number));
    expect(abortSession).toHaveBeenCalledWith('s1', undefined);
  });

  it('gate expõe acquire tipado: erro de banco = error, outro dono = held (com e sem teto)', async () => {
    for (const capacity of [undefined, { maxSessions: 5 }]) {
      const repo = fakeRepo();
      const c = buildSessionLeaseContainer(repo, 'w1', capacity);
      vi.mocked(repo.tryAcquire).mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      expect(await c.gate.acquireResult!('s1')).toBe('error');
      expect(await c.gate.acquireResult!('s1')).toBe('held');
      expect(await c.gate.acquireResult!('s1')).toBe('acquired');
    }
  });

  it('com teto cheio: acquire tipado de sessão nova = held', async () => {
    const c = buildSessionLeaseContainer(fakeRepo(), 'w1', { maxSessions: 1 });
    c.bindSocketControl({
      abortSession: vi.fn(), suspendSession: vi.fn(), resumeSession: vi.fn(), forgetSuspension: vi.fn(), closeAllSockets: vi.fn(),
      listLocalSessionIds: () => ['a'],
    });
    expect(await c.gate.acquireResult!('nova')).toBe('held');
  });

  it('flag off: gate é o de antes, sem teto (nega nada com sockets cheios)', async () => {
    const repo = fakeRepo();
    const c = buildSessionLeaseContainer(repo, 'w1');
    c.bindSocketControl({
      abortSession: vi.fn(), suspendSession: vi.fn(), resumeSession: vi.fn(), forgetSuspension: vi.fn(), closeAllSockets: vi.fn(),
      listLocalSessionIds: () => ['a', 'b', 'c'],
    });
    expect(c.gate.constructor).toBe(Object);
    expect(await c.gate.acquire('s1')).toBe(true);
    expect(repo.tryAcquire).toHaveBeenCalledTimes(1);
  });

  it('com teto: cheio nega sessão nova, aceita a local; release segue o base', async () => {
    const repo = fakeRepo();
    const c = buildSessionLeaseContainer(repo, 'w1', { maxSessions: 2 });
    let local = ['a'];
    c.bindSocketControl({
      abortSession: vi.fn(), suspendSession: vi.fn(), resumeSession: vi.fn(), forgetSuspension: vi.fn(), closeAllSockets: vi.fn(),
      listLocalSessionIds: () => local,
    });
    expect(c.listLocal()).toEqual(['a']);
    expect(await c.gate.acquire('s1')).toBe(true);
    local = ['a', 's1'];
    expect(await c.gate.acquire('s2')).toBe(false);
    expect(await c.gate.acquire('a')).toBe(true);
    expect(repo.tryAcquire).toHaveBeenCalledTimes(2);
    await c.gate.release!('s1');
    expect(repo.release).toHaveBeenCalledWith('s1', 'w1');
  });

  it('singleton lê a flag: ligada monta o gate com o teto da env', async () => {
    vi.resetModules();
    adoptionCfg.enabled = true;
    try {
      const mod = await import('./sessionLeaseContainer');
      const c = mod.sessionLeaseContainer();
      c.bindSocketControl({
        abortSession: vi.fn(), suspendSession: vi.fn(), resumeSession: vi.fn(), forgetSuspension: vi.fn(), closeAllSockets: vi.fn(),
        listLocalSessionIds: () => ['x'],
      });
      expect(await c.gate.acquire('nova')).toBe(false);
    } finally {
      adoptionCfg.enabled = false;
    }
  });
});
