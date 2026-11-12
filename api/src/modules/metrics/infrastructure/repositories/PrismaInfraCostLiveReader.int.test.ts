import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import type { OpsMetricSample } from '../../domain/OpsMetric';
import { PrismaInfraCostLiveReader } from './PrismaInfraCostLiveReader';
import { PrismaOpsMetricsSampleRepository } from './PrismaOpsMetricsSampleRepository';

const SRV = 'srv-teste';
const samples = new PrismaOpsMetricsSampleRepository(prisma);
const reader = new PrismaInfraCostLiveReader(prisma, SRV);
const now = new Date('2026-11-12T12:00:00.000Z');
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const render = (resource: string, at: Date, metric = 'cpu_pct'): OpsMetricSample =>
  ({ at, source: 'render', resource, metric, value: 10, meta: null });
const cluster = (metric: string, at: Date, value: number): OpsMetricSample =>
  ({ at, source: 'sessions', resource: 'cluster', metric, value, meta: null });

beforeEach(async () => {
  await prisma.opsMetricsSample.deleteMany({});
});
afterAll(async () => {
  await prisma.opsMetricsSample.deleteMany({});
  await prisma.$disconnect();
});

describe('PrismaInfraCostLiveReader', () => {
  it('sem amostra → tudo null', async () => {
    expect(await reader.read(now)).toEqual({
      sessionsConnected: null, sessionsCapacity: null, sessionsSampledAt: null, workerInstances: null,
    });
  });

  it('1 instância: várias amostras da mesma réplica contam 1', async () => {
    await samples.insertMany([
      render(`${SRV}-abc12`, ago(10)), render(`${SRV}-abc12`, ago(5)), render(`${SRV}-abc12`, ago(5), 'memory_pct'),
    ]);
    expect((await reader.read(now)).workerInstances).toBe(1);
  });

  it('2 instâncias distintas; antiga (> 15 min), outro serviço e outra fonte ficam fora', async () => {
    await samples.insertMany([
      render(`${SRV}-abc12`, ago(3)),
      render(`${SRV}-def34`, ago(3.5)),
      render(`${SRV}-old99`, ago(16)),
      render('srv-outro-zz1', ago(1)),
      render('srv-testex-zz2', ago(1)),
      { ...render(`${SRV}-hb777`, ago(1)), source: 'worker' },
      render(`${SRV}-rss01`, ago(1), 'rss_mb'),
      render(SRV, ago(2)),
    ]);
    expect((await reader.read(now)).workerInstances).toBe(2);
  });

  it('deploy: antiga com última amostra há 5 min e nova há 30 s → 1', async () => {
    await samples.insertMany([
      render(`${SRV}-old11`, ago(12)), render(`${SRV}-old11`, ago(5)), render(`${SRV}-new22`, ago(0.5)),
    ]);
    expect((await reader.read(now)).workerInstances).toBe(1);
  });

  it('só o id do serviço sem sufixo conta 1', async () => {
    await samples.insertMany([render(SRV, ago(4))]);
    expect((await reader.read(now)).workerInstances).toBe(1);
  });

  it('id do worker ausente ou inválido → instâncias null', async () => {
    await samples.insertMany([render(`${SRV}-abc12`, ago(3))]);
    expect((await new PrismaInfraCostLiveReader(prisma, null).read(now)).workerInstances).toBeNull();
    expect((await new PrismaInfraCostLiveReader(prisma, 'srv-X; drop').read(now)).workerInstances).toBeNull();
  });

  it('última sessions_connected e sessions_capacity na janela de 1 h', async () => {
    await samples.insertMany([
      cluster('sessions_connected', ago(70), 99),
      cluster('sessions_connected', ago(20), 40),
      cluster('sessions_connected', ago(5), 42),
      cluster('sessions_capacity', ago(10), 180),
      cluster('sessions_pending_login', ago(1), 7),
      { ...cluster('sessions_connected', ago(1), 500), resource: 'outro' },
    ]);
    expect(await reader.read(now)).toEqual({
      sessionsConnected: 42, sessionsCapacity: 180, sessionsSampledAt: ago(5), workerInstances: null,
    });
  });

  it('sessionsSampledAt é o horário da sessions_connected, mesmo com sessions_capacity mais nova', async () => {
    await samples.insertMany([cluster('sessions_connected', ago(30), 12), cluster('sessions_capacity', ago(2), 180)]);
    const r = await reader.read(now);
    expect([r.sessionsConnected, r.sessionsCapacity, r.sessionsSampledAt]).toEqual([12, 180, ago(30)]);
  });

  it('só sessions_capacity na janela → sessionsSampledAt null', async () => {
    await samples.insertMany([cluster('sessions_capacity', ago(2), 180)]);
    const r = await reader.read(now);
    expect([r.sessionsConnected, r.sessionsCapacity, r.sessionsSampledAt]).toEqual([null, 180, null]);
  });

  it('sessões só fora da janela (> 1 h) → null', async () => {
    await samples.insertMany([cluster('sessions_connected', ago(61), 10), cluster('sessions_capacity', ago(90), 20)]);
    const r = await reader.read(now);
    expect([r.sessionsConnected, r.sessionsCapacity, r.sessionsSampledAt]).toEqual([null, null, null]);
  });
});
