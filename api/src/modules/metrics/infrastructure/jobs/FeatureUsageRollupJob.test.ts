import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IJobLease, IJobLeaseRenewal } from '../../../../shared/jobs/IJobLease';
import type { FeatureUsageReadResult } from '../../domain/contracts/IFeatureUsageReader';
import type { FeatureUsageRollupState } from '../../domain/contracts/IFeatureUsageRollupStateRepository';
import type { FeatureUsageDefinition } from '../../domain/services/featureUsageCatalog';
import {
  FEATURE_USAGE_ROLLUP_LEASE,
  FEATURE_USAGE_ROLLUP_LEASE_TTL_MS,
  RollupFeatureUsageUseCase,
} from '../../application/use-cases/RollupFeatureUsageUseCase';
import { startFeatureUsageRollupJob } from '../featureUsageRollupStart';
import { FEATURE_USAGE_ROLLUP_TICK_MS, FeatureUsageRollupJob } from './FeatureUsageRollupJob';

/** Lease com a semântica do `PrismaJobLease`: adquire se livre ou vencido (`expiresAt < now`). */
class FakeLease implements IJobLease, IJobLeaseRenewal {
  readonly held = new Map<string, { owner: string; until: Date }>();
  async renew(name: string, ownerId: string, until: Date) {
    if (this.held.get(name)?.owner !== ownerId) return false;
    this.held.set(name, { owner: ownerId, until });
    return true;
  }
  async tryAcquire(name: string, ownerId: string, until: Date, now: Date) {
    const cur = this.held.get(name);
    if (cur && !(cur.until < now)) return false;
    this.held.set(name, { owner: ownerId, until });
    return true;
  }
  async release(name: string, ownerId: string) {
    if (this.held.get(name)?.owner === ownerId) this.held.delete(name);
  }
}

const done: FeatureUsageRollupState = { backfillCompletedAt: new Date(0), backfilledFrom: '2026-01-01', backfillStopReason: 'RETENTION', backfillCursor: null, cutovers: {}, lastSuccessAt: null, finalizedThrough: null, failureStreak: 0 };
const catalog = [
  { key: 'a', product: 'AFFILIATES', planFamily: 'AFFILIATES', kinds: ['ACTION'], source: 'LIVE', possibleCoverageReasons: [], phase: 1 },
] as unknown as FeatureUsageDefinition[];

afterEach(() => vi.useRealTimers());

describe('FeatureUsageRollupJob', () => {
  it('flag desligada não monta nem arma timer', () => {
    const factory = vi.fn();
    expect(startFeatureUsageRollupJob(false, factory)).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('ligada só arma o timer: nada executa no boot, o primeiro tick sai depois de 15 min', async () => {
    vi.useFakeTimers();
    const execute = vi.fn(async () => ({ status: 'skipped' as const }));
    const job = startFeatureUsageRollupJob(true, () => new FeatureUsageRollupJob({ rollup: { execute } }))!;
    expect(execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FEATURE_USAGE_ROLLUP_TICK_MS - 1);
    expect(execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledTimes(1);
    await job.stop();
    await vi.advanceTimersByTimeAsync(FEATURE_USAGE_ROLLUP_TICK_MS * 2);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('tick que ainda roda não é reentrado; erro do use case não escapa', async () => {
    let finish!: () => void;
    const execute = vi.fn(
      () => new Promise<{ status: 'skipped' }>((resolve) => (finish = () => resolve({ status: 'skipped' }))),
    );
    const job = new FeatureUsageRollupJob({ rollup: { execute } });
    const first = job.runTick();
    const second = job.runTick();
    expect(second).toBe(first);
    expect(execute).toHaveBeenCalledTimes(1);
    finish();
    await first;

    const failing = new FeatureUsageRollupJob({ rollup: { execute: vi.fn(async () => Promise.reject(new Error('x'))) } });
    await expect(failing.runTick()).resolves.toBeUndefined();
  });

  it('o TTL do lease é menor que o tick', () => {
    expect(FEATURE_USAGE_ROLLUP_LEASE_TTL_MS).toBeLessThan(FEATURE_USAGE_ROLLUP_TICK_MS);
  });

  it('segundo processo não adquire o lease enquanto o TTL vale e adquire depois que vence', async () => {
    const lease = new FakeLease();
    let now = new Date('2026-11-17T15:00:00Z');
    let hang!: () => void;
    const reads: string[] = [];
    const process = (owner: string, block: boolean) => {
      const reader = {
        read: vi.fn(async (): Promise<FeatureUsageReadResult> => {
          reads.push(owner);
          if (block) await new Promise<void>((r) => (hang = r));
          return { rows: [], firstDataDay: { a: null } as FeatureUsageReadResult['firstDataDay'] };
        }),
      };
      const rollup = new RollupFeatureUsageUseCase({
        reader,
        daily: { replaceDay: vi.fn(async () => undefined), purgeBefore: vi.fn(async () => 0), dayTotals: vi.fn(async () => ({})) },
        state: { get: async () => done, saveBackfillCursor: async () => undefined, markBackfillCompleted: async () => false, recordTick: async () => undefined },
        lease,
        newBudget: () => ({ remainingMs: () => 1000, track: () => undefined, settled: async () => undefined }),
        catalog,
        ownerId: owner,
        now: () => now,
        log: { warn: vi.fn(), info: vi.fn() },
      });
      return new FeatureUsageRollupJob({ rollup });
    };
    const a = process('owner-a', true);
    const b = process('owner-b', false);

    const tickA = a.runTick();
    await vi.waitFor(() => expect(reads).toEqual(['owner-a']));
    expect(lease.held.get(FEATURE_USAGE_ROLLUP_LEASE)?.owner).toBe('owner-a');

    now = new Date(now.getTime() + FEATURE_USAGE_ROLLUP_LEASE_TTL_MS - 1);
    await b.runTick();
    expect(reads).toEqual(['owner-a']);

    now = new Date(now.getTime() + 2);
    await b.runTick();
    expect(reads).toEqual(['owner-a', 'owner-b']);

    // Um terceiro pega o lease; A termina atrasado, não grava (renovação recusada) e não solta o que já não é dele
    await lease.tryAcquire(FEATURE_USAGE_ROLLUP_LEASE, 'owner-c', new Date(now.getTime() + 60_000), now);
    hang();
    await tickA;
    expect(lease.held.get(FEATURE_USAGE_ROLLUP_LEASE)?.owner).toBe('owner-c');
  });
});
