import { describe, it, expect, vi } from 'vitest';

vi.mock('../repositories/PrismaSessionLeaseRepository', () => ({
  PrismaSessionLeaseRepository: class {
    tryAcquire = vi.fn();
    renew = vi.fn();
    release = vi.fn();
    releaseAllOwned = vi.fn();
  },
}));
vi.mock('../../../../shared/config/workerIdentity', () => ({ currentWorkerId: () => 'worker-test' }));

import { buildSessionLeaseContainer, sessionLeaseContainer } from './sessionLeaseContainer';
import type { ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';

function fakeRepo(): ISessionLeaseRepository {
  return {
    tryAcquire: vi.fn().mockResolvedValue(true),
    renew: vi.fn().mockResolvedValue([]),
    release: vi.fn().mockResolvedValue(undefined),
    releaseAllOwned: vi.fn().mockResolvedValue(0),
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
      abortSession, suspendSession: vi.fn(), resumeSession: vi.fn(), closeAllSockets: vi.fn(), listLocalSessionIds: () => ['s1'],
    });
    await c.renew.execute(); // renew devolve [] = lease perdido → derruba
    expect(repo.renew).toHaveBeenCalledWith(['s1'], 'w1', expect.any(Number));
    expect(abortSession).toHaveBeenCalledWith('s1');
  });
});
