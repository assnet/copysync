import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaJobLease } from '../../../../shared/infrastructure/jobs/PrismaJobLease';
import { OPS_METRIC, type OpsMetricSample } from '../../../metrics/domain/OpsMetric';
import { PrismaOpsMetricsSampleRepository } from '../../../metrics/infrastructure/repositories/PrismaOpsMetricsSampleRepository';
import { ScaleWorkersUseCase } from '../../application/use-cases/ScaleWorkersUseCase';
import { makeAuditRepo } from '../../application/use-cases/sessionTestFakes';
import type { WorkerScalerState } from '../../domain/contracts/IWorkerScaler';
import { defaultWorkerScalingSettings, type WorkerScalingSettings } from '../../domain/services/workerScalingSettings';
import { PrismaWorkerScaleEventRepository } from '../repositories/PrismaWorkerScaleEventRepository';
import { AUTOSCALER_LEASE, WorkerAutoscalerJob, pairOccupancySamples } from './WorkerAutoscalerJob';

/** Job automático contra Postgres local: lease entre donos, leitura das amostras e fluxo completo (escalador falso). */
const lease = new PrismaJobLease(prisma);
const samples = new PrismaOpsMetricsSampleRepository(prisma);
const events = new PrismaWorkerScaleEventRepository(prisma);
const MIN = 60_000;

const sample = (metric: string, at: Date, value: number, resource = 'cluster'): OpsMetricSample => ({
  at, source: 'sessions', resource, metric, value, meta: { agg: metric === OPS_METRIC.sessionsConnected ? 'avg' : 'last' },
});

async function clean() {
  await prisma.jobLease.deleteMany({ where: { name: { startsWith: AUTOSCALER_LEASE } } });
  await prisma.opsMetricsSample.deleteMany({ where: { source: 'sessions' } });
  await prisma.workerScaleEvent.deleteMany({});
}

beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe('PrismaJobLease no nome do automático', () => {
  it('dois donos: lease vivo recusa o outro; vencido aceita e troca o dono', async () => {
    const t0 = new Date('2026-11-11T12:00:00.000Z');
    const until = new Date(t0.getTime() + 59_000);
    expect(await lease.tryAcquire(AUTOSCALER_LEASE, 'owner-a', until, t0)).toBe(true);
    expect(await lease.tryAcquire(AUTOSCALER_LEASE, 'owner-b', new Date(t0.getTime() + 90_000), new Date(t0.getTime() + 30_000))).toBe(false);
    // Exatamente no vencimento ainda vale (`expiresAt < now`).
    expect(await lease.tryAcquire(AUTOSCALER_LEASE, 'owner-b', new Date(t0.getTime() + 120_000), until)).toBe(false);
    expect((await prisma.jobLease.findUnique({ where: { name: AUTOSCALER_LEASE } }))?.ownerId).toBe('owner-a');
    const later = new Date(t0.getTime() + MIN);
    expect(await lease.tryAcquire(AUTOSCALER_LEASE, 'owner-b', new Date(later.getTime() + 59_000), later)).toBe(true);
    expect((await prisma.jobLease.findUnique({ where: { name: AUTOSCALER_LEASE } }))?.ownerId).toBe('owner-b');
  });
});

describe('listSince das amostras sessions_* usada pelo job', () => {
  it('corta por `at` (inclui o limite), mais nova primeiro, e pareia só sessions/cluster', async () => {
    const t0 = new Date('2026-11-11T12:00:00.000Z');
    const at = (min: number) => new Date(t0.getTime() - min * MIN);
    await samples.insertMany([
      sample(OPS_METRIC.sessionsConnected, at(0), 90),
      sample(OPS_METRIC.sessionsCapacity, at(0), 100),
      sample(OPS_METRIC.sessionsConnected, at(5), 85),
      sample(OPS_METRIC.sessionsCapacity, at(5), 100),
      sample(OPS_METRIC.sessionsConnected, at(5), 3, 'worker-1'),
      sample(OPS_METRIC.sessionsConnected, at(20), 10),
      sample(OPS_METRIC.sessionsCapacity, at(20), 100),
    ]);
    const since = at(5);
    const connected = await samples.listSince(OPS_METRIC.sessionsConnected, since);
    const capacity = await samples.listSince(OPS_METRIC.sessionsCapacity, since);
    expect(connected.map((s) => s.at.getTime())).toEqual([at(0).getTime(), at(5).getTime(), at(5).getTime()]);
    expect(capacity).toHaveLength(2);
    expect(pairOccupancySamples(connected, capacity)).toEqual([
      { at: at(0), connected: 90, capacity: 100 },
      { at: at(5), connected: 85, capacity: 100 },
    ]);
  });
});

describe('WorkerAutoscalerJob com repositórios reais', () => {
  it('sobe 1 réplica; outro dono depois não sobe de novo e a recusa do intervalo sai 1× sem reler o provedor', async () => {
    const settings: WorkerScalingSettings = {
      ...defaultWorkerScalingSettings({ maxSessionsPerWorker: 100, maxPendingLoginsPerWorker: 10 }),
      scalerMode: 'auto', minReplicas: 1, maxReplicas: 5, alertOccupancyRatio: 0.8,
      scaleUpSustainSeconds: 900, scaleCooldownSeconds: 1800, awaitingAlertSeconds: 120,
    };
    const provider = { current: () => ({ value: settings, origin: {} as never }) };
    let replicas = 1;
    const scaler = {
      getState: vi.fn(async (): Promise<WorkerScalerState> => ({
        status: 'ready', desiredReplicas: replicas, runningReplicas: replicas, hasDisk: false, autoscalingEnabled: false,
      })),
      scaleTo: vi.fn(async (n: number) => { replicas = n; }),
    };
    let awaiting = 0;
    const adoption = { countAwaitingCapacity: vi.fn(async () => awaiting) };
    const scale = new ScaleWorkersUseCase({
      events, scaler, settings: provider as never, audit: makeAuditRepo(), isAdoptionEnabled: () => true,
    });
    // Relógio real: `at` dos eventos vem do `now()` do banco.
    let clock = new Date();
    const newJob = () =>
      new WorkerAutoscalerJob({
        lease, settings: provider, samples, adoption, scaler, scale, events, isAdoptionEnabled: () => true, now: () => clock,
      });
    const at = (min: number) => new Date(clock.getTime() - min * MIN);
    await samples.insertMany([1, 6, 11].flatMap((m) => [
      sample(OPS_METRIC.sessionsConnected, at(m), 90),
      sample(OPS_METRIC.sessionsCapacity, at(m), 100),
    ]));

    await newJob().runTick();
    expect(scaler.scaleTo).toHaveBeenCalledWith(2);
    expect(await events.latestSucceeded()).toMatchObject({ trigger: 'auto', fromReplicas: 1, toReplicas: 2 });

    // Aguardando força a decisão nos ticks seguintes; intervalo de 30 min ainda ativo.
    awaiting = 1;
    for (const step of [2, 4, 4]) {
      clock = new Date(clock.getTime() + step * MIN);
      await newJob().runTick();
    }
    expect(scaler.scaleTo).toHaveBeenCalledTimes(1);
    expect(scaler.getState).toHaveBeenCalledTimes(1);
    const rejected = await prisma.workerScaleEvent.findMany({ where: { outcome: 'rejected' } });
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ trigger: 'auto', error: 'SCALE_COOLDOWN_ACTIVE', fromReplicas: 2, toReplicas: 3, requestId: null });
    expect(await events.latestByTrigger('auto')).toMatchObject({ outcome: 'rejected', error: 'SCALE_COOLDOWN_ACTIVE' });
  });
});
