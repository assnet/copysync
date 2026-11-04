import { describe, expect, it, vi } from 'vitest';
import { AcquireSessionLeaseUseCase } from './AcquireSessionLeaseUseCase';
import { ReleaseSessionLeaseUseCase } from './ReleaseSessionLeaseUseCase';
import { SessionLeaseLedger } from '../services/SessionLeaseLedger';
import { LEASE_TTL_MS } from '../../domain/services/sessionLeasePolicy';
import type { ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';

const NOW = new Date('2026-11-04T12:00:00Z');

function makeRepo(over: Partial<ISessionLeaseRepository> = {}): ISessionLeaseRepository {
  return {
    tryAcquire: vi.fn(async () => true),
    renew: vi.fn(async () => []),
    release: vi.fn(async () => undefined),
    releaseAllOwned: vi.fn(async () => 0),
    findLiveOwner: vi.fn(async () => null),
    ...over,
  };
}

const makeLog = () => ({ warn: vi.fn() });

describe('AcquireSessionLeaseUseCase', () => {
  it('adquire com workerId e TTL da política e grava no razão com o relógio injetado', async () => {
    const repo = makeRepo();
    const ledger = new SessionLeaseLedger();
    const uc = new AcquireSessionLeaseUseCase(repo, ledger, 'w1', () => NOW, makeLog());
    await expect(uc.acquire('s1')).resolves.toBe(true);
    expect(repo.tryAcquire).toHaveBeenCalledWith('s1', 'w1', LEASE_TTL_MS);
    expect(ledger.lastOk('s1')).toEqual(NOW);
  });

  it('lease de outro processo → false e não grava no razão', async () => {
    const ledger = new SessionLeaseLedger();
    const uc = new AcquireSessionLeaseUseCase(makeRepo({ tryAcquire: vi.fn(async () => false) }), ledger, 'w1', () => NOW, makeLog());
    await expect(uc.acquire('s1')).resolves.toBe(false);
    expect(ledger.ids()).toEqual([]);
  });

  it('erro de banco → false + log, sem lançar', async () => {
    const log = makeLog();
    const ledger = new SessionLeaseLedger();
    const repo = makeRepo({ tryAcquire: vi.fn(async () => { throw new Error('db down'); }) });
    const uc = new AcquireSessionLeaseUseCase(repo, ledger, 'w1', () => NOW, log);
    await expect(uc.acquire('s1')).resolves.toBe(false);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(ledger.ids()).toEqual([]);
  });
});

describe('AcquireSessionLeaseUseCase.acquireResult', () => {
  it('distingue acquired / held / error', async () => {
    const ledger = new SessionLeaseLedger();
    const tryAcquire = vi.fn<ISessionLeaseRepository['tryAcquire']>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('db down'));
    const uc = new AcquireSessionLeaseUseCase(makeRepo({ tryAcquire }), ledger, 'w1', () => NOW, makeLog());
    await expect(uc.acquireResult('s1')).resolves.toBe('acquired');
    await expect(uc.acquireResult('s2')).resolves.toBe('held');
    await expect(uc.acquireResult('s3')).resolves.toBe('error');
    expect(ledger.ids()).toEqual(['s1']);
  });
});

describe('ReleaseSessionLeaseUseCase', () => {
  it('tira do razão e solta no banco com o workerId', async () => {
    const repo = makeRepo();
    const ledger = new SessionLeaseLedger();
    ledger.markOk('s1', NOW);
    await new ReleaseSessionLeaseUseCase(repo, ledger, 'w1', makeLog()).execute('s1');
    expect(ledger.ids()).toEqual([]);
    expect(repo.release).toHaveBeenCalledWith('s1', 'w1');
  });

  it('erro de banco: tira do razão, loga e não lança', async () => {
    const log = makeLog();
    const ledger = new SessionLeaseLedger();
    ledger.markOk('s1', NOW);
    const repo = makeRepo({ release: vi.fn(async () => { throw new Error('db down'); }) });
    await expect(new ReleaseSessionLeaseUseCase(repo, ledger, 'w1', log).execute('s1')).resolves.toBeUndefined();
    expect(ledger.ids()).toEqual([]);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('sessão fora do razão ainda chama release no banco', async () => {
    const repo = makeRepo();
    await new ReleaseSessionLeaseUseCase(repo, new SessionLeaseLedger(), 'w1', makeLog()).execute('s9');
    expect(repo.release).toHaveBeenCalledWith('s9', 'w1');
  });
});
