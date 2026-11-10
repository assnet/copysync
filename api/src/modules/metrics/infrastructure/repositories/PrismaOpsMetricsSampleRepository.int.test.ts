import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import type { OpsMetricSample } from '../../domain/OpsMetric';
import { PrismaOpsMetricsSampleRepository } from './PrismaOpsMetricsSampleRepository';

const repo = new PrismaOpsMetricsSampleRepository(prisma);
const DAY = 86_400_000;
const now = new Date('2026-11-09T12:00:00.000Z');
const sample = (metric: string, at: Date, value = 1): OpsMetricSample =>
  ({ at, source: 'render', resource: 'srv-1', metric, value, meta: { min: value, max: value, n: 5 } });

beforeEach(async () => {
  await prisma.opsMetricsSample.deleteMany({});
});
afterAll(async () => {
  await prisma.opsMetricsSample.deleteMany({});
  await prisma.$disconnect();
});

describe('PrismaOpsMetricsSampleRepository', () => {
  it('insertMany + listSince por métrica, mais nova primeiro, com meta e sem meta', async () => {
    expect(await repo.insertMany([])).toBe(0);
    const count = await repo.insertMany([
      sample('cpu_pct', new Date(now.getTime() - 10 * 60_000), 70),
      sample('cpu_pct', new Date(now.getTime() - 5 * 60_000), 85.5),
      { ...sample('memory_pct', now), meta: null },
    ]);
    expect(count).toBe(3);
    const rows = await repo.listSince('cpu_pct', new Date(now.getTime() - 6 * 60_000));
    expect(rows).toEqual([sample('cpu_pct', new Date(now.getTime() - 5 * 60_000), 85.5)]);
    expect((await repo.listSince('memory_pct', new Date(0)))[0]!.meta).toBeNull();
  });

  it('deleteOlderThan apaga só o que passou da retenção de 7 dias', async () => {
    await repo.insertMany([
      sample('cpu_pct', new Date(now.getTime() - 8 * DAY)),
      sample('db_idle', new Date(now.getTime() - 7 * DAY - 1)),
      sample('cpu_pct', new Date(now.getTime() - 6 * DAY)),
    ]);
    expect(await repo.deleteOlderThan(new Date(now.getTime() - 7 * DAY))).toBe(2);
    const left = await prisma.opsMetricsSample.findMany();
    expect(left.map((r) => r.at.toISOString())).toEqual([new Date(now.getTime() - 6 * DAY).toISOString()]);
  });

  it('deleteOlderThan apaga em lotes e para no teto de lotes; o resto sai na chamada seguinte', async () => {
    const old = Array.from({ length: 7 }, (_, i) => sample('cpu_pct', new Date(now.getTime() - 8 * DAY - i * 60_000)));
    await repo.insertMany([...old, sample('cpu_pct', new Date(now.getTime() - DAY))]);
    const small = new PrismaOpsMetricsSampleRepository(prisma, { retentionBatchSize: 2, retentionMaxBatches: 2 });
    const cutoff = new Date(now.getTime() - 7 * DAY);
    expect(await small.deleteOlderThan(cutoff)).toBe(4);
    expect(await prisma.opsMetricsSample.count()).toBe(4);
    expect(await small.deleteOlderThan(cutoff)).toBe(3);
    expect(await small.deleteOlderThan(cutoff)).toBe(0);
    expect(await prisma.opsMetricsSample.count()).toBe(1);
  });

  it('índice (metric, at) existe', async () => {
    const idx = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'ops_metrics_samples' AND indexname = 'ops_metrics_samples_metric_at_idx'`;
    expect(idx[0]?.indexdef).toContain('(metric, at)');
  });

  it('índice (at) existe e o delete de retenção o usa', async () => {
    const idx = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'ops_metrics_samples' AND indexname = 'ops_metrics_samples_at_idx'`;
    expect(idx[0]?.indexdef).toContain('(at)');
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN DELETE FROM "ops_metrics_samples" WHERE "at" < '2026-11-02T12:00:00Z'`,
      );
    });
    expect(plan.map((r) => r['QUERY PLAN']).join('\n')).toContain('ops_metrics_samples_at_idx');
  });

  it('listPage: filtro por métrica e janela fechada, at desc + id desc, skip/take', async () => {
    const t = (min: number) => new Date(now.getTime() - min * 60_000);
    await repo.insertMany([
      sample('cpu_pct', t(20), 1),
      sample('cpu_pct', t(10), 2),
      sample('cpu_pct', t(10), 3),
      sample('cpu_pct', t(0), 4),
      sample('memory_pct', t(10), 5),
      sample('cpu_pct', t(30), 6),
    ]);
    const filter = { metric: 'cpu_pct', from: t(20), to: t(0) };
    expect((await repo.listPage(filter, 0, 10)).map((s) => s.value)).toEqual([4, 3, 2, 1]);
    expect((await repo.listPage(filter, 1, 2)).map((s) => s.value)).toEqual([3, 2]);
    const all = await repo.listPage({ metric: null, from: t(10), to: t(10) }, 0, 10);
    expect(all.map((s) => s.value)).toEqual([5, 3, 2]);
  });
});
