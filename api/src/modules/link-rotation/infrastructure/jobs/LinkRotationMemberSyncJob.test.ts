import { describe, expect, it } from 'vitest';
import type { ILinkRotationJobLease } from '../../domain/contracts/ILinkRotationJobLease';
import { LinkRotationMemberSyncJob, MEMBER_SYNC_LEASE } from './LinkRotationMemberSyncJob';

class FakeLease implements ILinkRotationJobLease {
  held = new Map<string, string>();
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
    const job = new LinkRotationMemberSyncJob({ lease, sync: () => part(calls, 'sync'), purge: () => part(calls, 'purge') });
    lease.held.set(MEMBER_SYNC_LEASE, 'outro');
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
    await new LinkRotationMemberSyncJob({ lease, sync: () => part(calls, 'sync', true), purge: () => part(calls, 'purge') }).runTick();
    await new LinkRotationMemberSyncJob({ lease, sync: () => null, purge: () => part(calls, 'purge') }).runTick();
    expect(calls).toEqual(['sync', 'purge', 'purge']);
  });

  it('stop sem tick em curso resolve', async () => {
    const job = new LinkRotationMemberSyncJob({ lease: new FakeLease(), sync: () => null, purge: () => ({ execute: async () => ({ processed: 0 }) }), intervalMs: 10 });
    job.start();
    await expect(job.stop()).resolves.toBeUndefined();
  });
});
