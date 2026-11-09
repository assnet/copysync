import { Prisma, type PrismaClient } from '@prisma/client';
import type { IOpsMetricsSampleReader, IOpsMetricsSampleRepository, OpsMetricsSampleFilter } from '../../domain/contracts/IOpsMetricsSampleRepository';
import type { OpsMetricMeta, OpsMetricSample, OpsMetricSource } from '../../domain/OpsMetric';

type Row = { at: Date; source: string; resource: string; metric: string; value: number; meta: Prisma.JsonValue };

const toSample = (r: Row): OpsMetricSample => ({
  at: r.at,
  source: r.source as OpsMetricSource,
  resource: r.resource,
  metric: r.metric,
  value: r.value,
  meta: r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? (r.meta as OpsMetricMeta) : null,
});

/** `ops_metrics_samples` (MQ-23). `at` vem do job (UTC); sem tenant: dado de infraestrutura. */
export class PrismaOpsMetricsSampleRepository implements IOpsMetricsSampleRepository, IOpsMetricsSampleReader {
  constructor(private readonly prisma: PrismaClient) {}

  async insertMany(samples: readonly OpsMetricSample[]): Promise<number> {
    if (samples.length === 0) return 0;
    const { count } = await this.prisma.opsMetricsSample.createMany({
      data: samples.map((s) => ({
        at: s.at,
        source: s.source,
        resource: s.resource,
        metric: s.metric,
        value: s.value,
        meta: s.meta ? (s.meta as Prisma.InputJsonObject) : Prisma.DbNull,
      })),
    });
    return count;
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.opsMetricsSample.deleteMany({ where: { at: { lt: cutoff } } });
    return count;
  }

  async listSince(metric: string, since: Date): Promise<OpsMetricSample[]> {
    const rows = await this.prisma.opsMetricsSample.findMany({
      where: { metric, at: { gte: since } },
      orderBy: { at: 'desc' },
      select: { at: true, source: true, resource: true, metric: true, value: true, meta: true },
    });
    return rows.map(toSample);
  }

  async listPage(filter: OpsMetricsSampleFilter, offset: number, limit: number): Promise<OpsMetricSample[]> {
    const rows = await this.prisma.opsMetricsSample.findMany({
      where: { ...(filter.metric ? { metric: filter.metric } : {}), at: { gte: filter.from, lte: filter.to } },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
      select: { at: true, source: true, resource: true, metric: true, value: true, meta: true },
    });
    return rows.map(toSample);
  }
}
