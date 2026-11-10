import { Prisma, type PrismaClient } from '@prisma/client';
import type { IOpsMetricsSampleReader, IOpsMetricsSampleRepository, OpsMetricsSampleFilter } from '../../domain/contracts/IOpsMetricsSampleRepository';
import type { IOpsMetricsSeriesReader, OpsMetricBucketRow, OpsMetricsSeriesFilter } from '../../domain/contracts/IOpsMetricsSeriesReader';
import { OPS_COUNTER_METRICS, OPS_METRIC, type OpsMetricMeta, type OpsMetricSample, type OpsMetricSource } from '../../domain/OpsMetric';

type Row = { at: Date; source: string; resource: string; metric: string; value: number; meta: Prisma.JsonValue };

const toSample = (r: Row): OpsMetricSample => ({
  at: r.at,
  source: r.source as OpsMetricSource,
  resource: r.resource,
  metric: r.metric,
  value: r.value,
  meta: r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? (r.meta as OpsMetricMeta) : null,
});

/** Linhas por DELETE da retenção: lote curto, sem lock longo nem WAL em rajada. */
export const OPS_RETENTION_BATCH_SIZE = 5_000;
/**
 * Teto de lotes por chamada (por tick de persistência); o resto sai nos ticks seguintes.
 * Pior caso 10 × 2 s = 20 s: cabe no lease de 45 s renovado antes do `persist` do sampler.
 */
export const OPS_RETENTION_MAX_BATCHES = 10;
/** Cada lote morre aqui em vez de prender a conexão (lock ou disco lento). */
export const OPS_RETENTION_STATEMENT_TIMEOUT = '2s';

/** Teto das leituras agregadas do dashboard: consulta pesada morre em vez de prender a conexão. */
export const OPS_READ_STATEMENT_TIMEOUT = '2s';

/** ISO (UTC) → `timestamp` sem fuso, explícito: independe do `TimeZone` da sessão. */
const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

export interface PrismaOpsMetricsSampleRepositoryOptions {
  retentionBatchSize?: number;
  retentionMaxBatches?: number;
}

/** `ops_metrics_samples` (MQ-23). `at` vem do job (UTC); sem tenant: dado de infraestrutura. */
export class PrismaOpsMetricsSampleRepository implements IOpsMetricsSampleRepository, IOpsMetricsSampleReader, IOpsMetricsSeriesReader {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: PrismaOpsMetricsSampleRepositoryOptions = {},
  ) {}

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

  /**
   * Retenção em lotes de `ctid` (5 mil) com `statement_timeout` de 2 s por lote (`SET LOCAL` só vale
   * dentro da transação) e no máximo 10 lotes por chamada. Backlog maior (ex.: job parado dias)
   * escoa nos ticks seguintes. Lote que estoura o timeout lança; os anteriores ficam apagados.
   * `at` é `timestamp` sem fuso gravado em UTC: o corte é convertido explicitamente (independe do
   * `TimeZone` da sessão).
   */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const batch = this.options.retentionBatchSize ?? OPS_RETENTION_BATCH_SIZE;
    const maxBatches = this.options.retentionMaxBatches ?? OPS_RETENTION_MAX_BATCHES;
    let total = 0;
    for (let i = 0; i < maxBatches; i++) {
      const [, deleted] = await this.prisma.$transaction([
        this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${OPS_RETENTION_STATEMENT_TIMEOUT}'`),
        this.prisma.$executeRaw`
          DELETE FROM "ops_metrics_samples" WHERE ctid IN (
            SELECT ctid FROM "ops_metrics_samples" WHERE "at" < (${cutoff.toISOString()}::timestamptz AT TIME ZONE 'UTC') LIMIT ${batch}
          )`,
      ]);
      total += deleted;
      if (deleted < batch) break;
    }
    return total;
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

  /**
   * Baldes alinhados à época: `extract(epoch FROM at)` de `timestamp` sem fuso é nominal (= UTC),
   * então o balde não depende do `TimeZone` da sessão. Devolve o início do balde em segundos
   * (`float8`) para não passar por conversão de fuso no driver.
   * - min/max de gauge vêm de `meta.min`/`meta.max` (pico dentro dos 5 min; `value` é a média);
   *   counter ou `meta` sem número → `value`.
   * - Teto no SQL: `db_statement_total_ms` só os `maxStatementSeries` `queryid` de maior
   *   `max(value)` na janela; depois no máximo `maxSeries` séries (ordem resource, metric, source).
   */
  async aggregate(f: OpsMetricsSeriesFilter): Promise<OpsMetricBucketRow[]> {
    if (f.metrics.length === 0 || f.maxSeries <= 0) return [];
    const step = f.bucketMinutes * 60;
    const byResource = f.resource === null ? Prisma.empty : Prisma.sql`AND "resource" = ${f.resource}`;
    const counters = [...OPS_COUNTER_METRICS];
    const stmt = OPS_METRIC.dbStatementTotalMs;
    const peak = (key: 'min' | 'max') => Prisma.sql`CASE
      WHEN "metric" = ANY(${counters}::text[]) OR jsonb_typeof("meta"::jsonb -> ${key}) IS DISTINCT FROM 'number' THEN "value"
      ELSE ("meta"::jsonb ->> ${key})::float8 END`;
    const [, rows] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${OPS_READ_STATEMENT_TIMEOUT}'`),
      this.prisma.$queryRaw<{ source: string; resource: string; metric: string; bucket: number; avg: number; min: number; max: number }[]>`
        WITH base AS (
          SELECT "source", "resource", "metric", "at", "value", ${peak('min')} AS lo, ${peak('max')} AS hi
          FROM "ops_metrics_samples"
          WHERE "metric" = ANY(${[...f.metrics]}::text[]) AND "at" >= ${utc(f.from)} AND "at" <= ${utc(f.to)} ${byResource}
        ), top_statements AS (
          SELECT "resource" FROM base WHERE "metric" = ${stmt}
          GROUP BY "resource" ORDER BY max("value") DESC, "resource" LIMIT ${Math.max(0, f.maxStatementSeries)}::int
        ), series AS (
          SELECT DISTINCT "source", "resource", "metric" FROM base
          WHERE "metric" <> ${stmt} OR "resource" IN (SELECT "resource" FROM top_statements)
          ORDER BY "resource", "metric", "source" LIMIT ${f.maxSeries}::int
        )
        SELECT b."source", b."resource", b."metric",
          (floor(extract(epoch FROM b."at") / ${step}::int) * ${step}::int)::float8 AS bucket,
          avg(b."value")::float8 AS avg, min(b.lo)::float8 AS min, max(b.hi)::float8 AS max
        FROM base b JOIN series USING ("source", "resource", "metric")
        GROUP BY 1, 2, 3, 4
        ORDER BY b."resource", b."metric", b."source", bucket`,
    ]);
    return rows.map((r) => ({
      source: r.source as OpsMetricSource,
      resource: r.resource,
      metric: r.metric,
      at: new Date(r.bucket * 1000),
      avg: r.avg,
      min: r.min,
      max: r.max,
    }));
  }

  async latestSince(since: Date): Promise<OpsMetricSample[]> {
    const [, rows] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${OPS_READ_STATEMENT_TIMEOUT}'`),
      this.prisma.$queryRaw<{ at_s: number; source: string; resource: string; metric: string; value: number; meta: Prisma.JsonValue }[]>`
        SELECT DISTINCT ON ("resource", "metric")
          extract(epoch FROM "at")::float8 AS at_s, "source", "resource", "metric", "value", "meta"
        FROM "ops_metrics_samples"
        WHERE "at" >= ${utc(since)} AND "metric" <> ${OPS_METRIC.dbStatementTotalMs}
        ORDER BY "resource", "metric", "at" DESC, "id" DESC`,
    ]);
    return rows.map((r) => toSample({ ...r, at: new Date(r.at_s * 1000) }));
  }

  /** Mesmo teto de 2 s das outras leituras: as duas consultas na mesma transação. */
  async latestStatementSnapshot(): Promise<OpsMetricSample[]> {
    const metric = OPS_METRIC.dbStatementTotalMs;
    const [, rows] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${OPS_READ_STATEMENT_TIMEOUT}'`),
      this.prisma.$queryRaw<{ at_s: number; source: string; resource: string; metric: string; value: number; meta: Prisma.JsonValue }[]>`
        SELECT extract(epoch FROM "at")::float8 AS at_s, "source", "resource", "metric", "value", "meta"
        FROM "ops_metrics_samples"
        WHERE "metric" = ${metric}
          AND "at" = (SELECT max("at") FROM "ops_metrics_samples" WHERE "metric" = ${metric})
        ORDER BY "value" DESC, "id" ASC`,
    ]);
    return rows.map((r) => toSample({ ...r, at: new Date(r.at_s * 1000) }));
  }
}
