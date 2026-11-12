import { describe, expect, it } from 'vitest';
import type { ILinkRotationJobLease } from '../../domain/contracts/ILinkRotationJobLease';
import type { IJobLeaseSweep } from '../../../../shared/jobs/IJobLease';
import { LinkRotationMemberSyncJob, MEMBER_SYNC_LEASE, memberSyncLeaseName } from './LinkRotationMemberSyncJob';

class FakeLease implements ILinkRotationJobLease, IJobLeaseSweep {
  held = new Map<string, string>();
  sweeps: Array<{ prefix: string; before: Date }> = [];
  failSweep = false;
  async deleteExpiredByPrefix(prefix: string, before: Date): Promise<number> {
    this.sweeps.push({ prefix, before });
    if (this.failSweep) throw new Error('db');
    return 0;
  }
  async tryAcquire(name: string, owner: string): Promise<boolean> {
    if (this.held.has(name)) return false;
    this.held.set(name, owner);
    return true;
  }
  async release(name: string, owner: string): Promise<void> {
    if (this.held.get(name) === owner) this.held.delete(name);
  }
}

const part = (calls: string[], name: string, fail = false) => ({
  execute: async () => {
    calls.push(name);
    if (fail) throw new Error('x');
    return { processed: 1 };
  },
});

describe('LinkRotationMemberSyncJob', () => {
  it('sem lease não roda; com lease roda sync + retenção e libera', async () => {
    const lease = new FakeLease();
    const calls: string[] = [];
    const job = new LinkRotationMemberSyncJob({ lease, workerId: 'w1', sync: () => part(calls, 'sync'), purge: () => part(calls, 'purge') });
    lease.held.set(memberSyncLeaseName('w1'), 'outro');
    await job.runTick();
    expect(calls).toEqual([]);
    lease.held.clear();
    await job.runTick();
    expect(calls).toEqual(['sync', 'purge']);
    expect(lease.held.size).toBe(0);
  });

  it('falha numa parte não impede a outra; engine ausente pula só o sync', async () => {
    const lease = new FakeLease();
    const calls: string[] = [];
    await new LinkRotationMemberSyncJob({ lease, workerId: 'w1', sync: () => part(calls, 'sync', true), purge: () => part(calls, 'purge') }).runTick();
    await new LinkRotationMemberSyncJob({ lease, workerId: 'w1', sync: () => null, purge: () => part(calls, 'purge') }).runTick();
    expect(calls).toEqual(['sync', 'purge', 'purge']);
  });

  it('lease por processo: dois workerIds rodam no mesmo tick; mesmo workerId ocupado não roda', async () => {
    const lease = new FakeLease();
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const slow = { execute: async () => { calls.push('a'); await gate; return { processed: 1 }; } };
    const a = new LinkRotationMemberSyncJob({ lease, workerId: 'wa', sync: () => slow, purge: () => part(calls, 'purge-a') });
    const b = new LinkRotationMemberSyncJob({ lease, workerId: 'wb', sync: () => part(calls, 'b'), purge: () => part(calls, 'purge-b') });
    const a2 = new LinkRotationMemberSyncJob({ lease, workerId: 'wa', sync: () => part(calls, 'a2'), purge: () => part(calls, 'purge-a2') });
    const tickA = a.runTick();
    await new Promise((res) => setImmediate(res));
    expect(lease.held.get(memberSyncLeaseName('wa'))).toBeDefined();
    await b.runTick();
    await a2.runTick();
    release();
    await tickA;
    expect(calls).toEqual(['a', 'b', 'purge-b', 'purge-a']);
    expect(lease.held.size).toBe(0);
  });

  it('cada tick apaga leases do prefixo vencidos há > 1 dia; falha na limpeza não impede o tick', async () => {
    const lease = new FakeLease();
    const calls: string[] = [];
    const now = new Date('2026-11-11T12:00:00.000Z');
    const job = new LinkRotationMemberSyncJob({ lease, workerId: 'w1', now: () => now, sync: () => part(calls, 'sync'), purge: () => part(calls, 'purge') });
    await job.runTick();
    expect(lease.sweeps).toEqual([{ prefix: `${MEMBER_SYNC_LEASE}:`, before: new Date('2026-11-10T12:00:00.000Z') }]);
    lease.failSweep = true;
    await job.runTick();
    expect(calls).toEqual(['sync', 'purge', 'sync', 'purge']);
  });

  it('stop sem tick em curso resolve', async () => {
    const job = new LinkRotationMemberSyncJob({ lease: new FakeLease(), workerId: 'w1', sync: () => null, purge: () => ({ execute: async () => ({ processed: 0 }) }), intervalMs: 10 });
    job.start();
    await expect(job.stop()).resolves.toBeUndefined();
  });
});
