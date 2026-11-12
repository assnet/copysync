import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  IInfraCostSnapshotRepository,
  InfraCostSnapshotPurgeResult,
  InfraFxRateRecord,
  InfraFxRateSource,
  InfraResourceHourSnapshot,
  InfraUsageDailyValue,
  InfraUsageMetric,
  TenantSessionHourSample,
} from '../../domain/contracts/IInfraCostSnapshotRepository';
import type {
  IInfraCostMonthRepository,
  InfraCostClosedMonth,
  InfraCostClosedMonthSummary,
} from '../../domain/contracts/IInfraCostMonthRepository';
import type { InfraFxClosingMethod } from '../../domain/services/infraCostSettings';

/** Lote da retenção: curto, sem lock longo nem WAL em rajada (mesmo padrão de `ops_metrics_samples`). */
export const INFRA_SNAPSHOT_RETENTION_BATCH_SIZE = 5_000;
/** Teto de lotes por tabela por chamada; o resto sai na limpeza seguinte. */
export const INFRA_SNAPSHOT_RETENTION_MAX_BATCHES = 10;
/** Cada lote morre aqui em vez de prender a conexão. */
export const INFRA_SNAPSHOT_RETENTION_STATEMENT_TIMEOUT = '2s';

const HOUR_MS = 3_600_000;

/** Hora cheia (UTC): a PK é por hora, minuto/segundo nunca entram. */
const floorHour = (d: Date) => new Date(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS);
/** ISO (UTC) → `timestamp` sem fuso, explícito: independe do `TimeZone` da sessão. */
const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
/** Dia (UTC) → `date`. */
const utcDay = (d: Date) => Prisma.sql`${d.toISOString().slice(0, 10)}::date`;

/** Tabelas e coluna de corte da retenção (identificadores fixos, nunca entrada). */
const RETENTION_TARGETS = [
  { key: 'resourceHours', table: 'infra_resource_hours', column: 'hour', kind: 'timestamp' },
  { key: 'sessionHours', table: 'tenant_session_hours', column: 'day', kind: 'date' },
  { key: 'fxRates', table: 'infra_fx_rates', column: 'referenceDate', kind: 'date' },
  { key: 'usageDaily', table: 'infra_usage_daily', column: 'day', kind: 'date' },
] as const;

export interface PrismaInfraCostSnapshotRepositoryOptions {
  retentionBatchSize?: number;
  retentionMaxBatches?: number;
}

const usd = (n: number) => new Prisma.Decimal(n.toFixed(4));
/** Dia 1 do mês (UTC) da data. */
const monthDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/**
 * Snapshots dos custos da infraestrutura (COST-09/10) e fechamento mensal (COST-15). `tenant_session_hours`
 * e `infra_cost_month_tenants` são as tabelas tenant-aware.
 */
export class PrismaInfraCostSnapshotRepository implements IInfraCostSnapshotRepository, IInfraCostMonthRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: PrismaInfraCostSnapshotRepositoryOptions = {},
  ) {}

  async hasResourceHour(hour: Date): Promise<boolean> {
    const row = await this.prisma.infraResourceHour.findFirst({ where: { hour: floorHour(hour) }, select: { resourceKey: true } });
    return row !== null;
  }

  /** Último valor de cada `resourceKey` no lote vence; conflito regrava (nunca soma). */
  async upsertResourceHours(rows: readonly InfraResourceHourSnapshot[]): Promise<number> {
    const byKey = new Map<string, InfraResourceHourSnapshot>();
    for (const r of rows) byKey.set(`${floorHour(r.hour).toISOString()}|${r.resourceKey}`, r);
    if (byKey.size === 0) return 0;
    const values = [...byKey.values()].map(
      (r) => Prisma.sql`(${utc(floorHour(r.hour))}, ${r.resourceKey}, ${r.plan}, ${r.instances}::int, ${r.instancesSource},
        ${r.diskGb}::int, ${r.suspended})`,
    );
    return this.prisma.$executeRaw`
      INSERT INTO "infra_resource_hours" ("hour", "resourceKey", "plan", "instances", "instancesSource", "diskGb", "suspended")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("hour", "resourceKey") DO UPDATE SET
        "plan" = EXCLUDED."plan", "instances" = EXCLUDED."instances", "instancesSource" = EXCLUDED."instancesSource",
        "diskGb" = EXCLUDED."diskGb", "suspended" = EXCLUDED."suspended", "readAt" = CURRENT_TIMESTAMP`;
  }

  /**
   * Incremento condicional: a linha do dia só soma se `lastHour < hour`. Dois processos na mesma
   * hora: o segundo encontra `lastHour = hour` e não soma. Tenant repetido no lote é somado antes.
   */
  async addSessionHour(hour: Date, samples: readonly TenantSessionHourSample[]): Promise<number> {
    const merged = new Map<string, TenantSessionHourSample>();
    for (const s of samples) {
      const prev = merged.get(s.tenantId);
      merged.set(
        s.tenantId,
        prev
          ? {
              tenantId: s.tenantId,
              planSlug: s.planSlug ?? prev.planSlug,
              connectedSessions: prev.connectedSessions + s.connectedSessions,
              contractedSessions: prev.contractedSessions + s.contractedSessions,
            }
          : s,
      );
    }
    if (merged.size === 0) return 0;
    const h = floorHour(hour);
    const values = [...merged.values()].map(
      (s) => Prisma.sql`(${utc(h)}::date, ${s.tenantId}, ${s.planSlug}, ${s.connectedSessions}::int, ${s.contractedSessions}::int, 1, ${utc(h)})`,
    );
    return this.prisma.$executeRaw`
      INSERT INTO "tenant_session_hours" AS t
        ("day", "tenantId", "planSlug", "connectedHours", "contractedSessions", "contractedSamples", "lastHour")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("day", "tenantId") DO UPDATE SET
        "connectedHours" = t."connectedHours" + EXCLUDED."connectedHours",
        "contractedSessions" = t."contractedSessions" + EXCLUDED."contractedSessions",
        "contractedSamples" = t."contractedSamples" + 1,
        "planSlug" = COALESCE(EXCLUDED."planSlug", t."planSlug"),
        "lastHour" = EXCLUDED."lastHour"
      WHERE t."lastHour" < EXCLUDED."lastHour"`;
  }

  async upsertFxRate(record: InfraFxRateRecord): Promise<void> {
    const data = { rate: new Prisma.Decimal(record.rate.toFixed(4)), source: record.source, fetchedAt: record.fetchedAt };
    await this.prisma.infraFxRate.upsert({
      where: { referenceDate: record.referenceDate },
      create: { referenceDate: record.referenceDate, ...data },
      update: data,
    });
  }

  async latestFxRate(onOrBefore: Date): Promise<InfraFxRateRecord | null> {
    const row = await this.prisma.infraFxRate.findFirst({
      where: { referenceDate: { lte: onOrBefore } },
      orderBy: { referenceDate: 'desc' },
    });
    if (!row) return null;
    return { referenceDate: row.referenceDate, rate: row.rate.toNumber(), source: row.source as InfraFxRateSource, fetchedAt: row.fetchedAt };
  }

  /** Banda: soma a hora no dia (UTC) só se a hora ainda não entrou (`lastHour`). */
  async addUsageHour(hour: Date, v: Omit<InfraUsageDailyValue, 'day'>): Promise<boolean> {
    const h = floorHour(hour);
    const n = await this.prisma.$executeRaw`
      INSERT INTO "infra_usage_daily" AS d ("day", "metric", "resourceKey", "value", "source", "lastHour", "hours")
      VALUES (${utc(h)}::date, ${v.metric}, ${v.resourceKey}, ${v.value}::float8, ${v.source}, ${utc(h)}, 1)
      ON CONFLICT ("day", "metric", "resourceKey") DO UPDATE SET
        "value" = d."value" + EXCLUDED."value", "source" = EXCLUDED."source", "hours" = d."hours" + 1,
        "lastHour" = EXCLUDED."lastHour", "readAt" = CURRENT_TIMESTAMP
      WHERE d."lastHour" IS NULL OR d."lastHour" < EXCLUDED."lastHour"`;
    return n > 0;
  }

  async lastUsageHour(metric: InfraUsageMetric, since: Date): Promise<Date | null> {
    const [row] = await this.prisma.$queryRaw<{ last: Date | null }[]>`
      SELECT max("lastHour") AS last FROM "infra_usage_daily"
      WHERE "metric" = ${metric} AND "day" >= ${utcDay(since)} AND "lastHour" >= ${utc(since)}`;
    return row?.last ?? null;
  }

  /** Build: regrava o dia inteiro (idempotente). */
  async upsertUsageDay(v: InfraUsageDailyValue): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "infra_usage_daily" ("day", "metric", "resourceKey", "value", "source", "lastHour")
      VALUES (${utcDay(v.day)}, ${v.metric}, ${v.resourceKey}, ${v.value}::float8, ${v.source}, NULL)
      ON CONFLICT ("day", "metric", "resourceKey") DO UPDATE SET
        "value" = EXCLUDED."value", "source" = EXCLUDED."source", "lastHour" = NULL, "readAt" = CURRENT_TIMESTAMP`;
  }

  /**
   * Retenção por tabela em lotes de `ctid` (5 mil) com `statement_timeout` de 2 s por lote (`SET LOCAL`
   * só vale na transação) e no máximo 10 lotes por tabela. Colunas `date` cortam pelo dia (UTC) de `cutoff`.
   */
  async deleteOlderThan(cutoff: Date): Promise<InfraCostSnapshotPurgeResult> {
    const batch = this.options.retentionBatchSize ?? INFRA_SNAPSHOT_RETENTION_BATCH_SIZE;
    const maxBatches = this.options.retentionMaxBatches ?? INFRA_SNAPSHOT_RETENTION_MAX_BATCHES;
    const result: InfraCostSnapshotPurgeResult = { resourceHours: 0, sessionHours: 0, fxRates: 0, usageDaily: 0 };
    for (const t of RETENTION_TARGETS) {
      const table = Prisma.raw(`"${t.table}"`);
      const column = Prisma.raw(`"${t.column}"`);
      const bound = t.kind === 'date' ? utcDay(cutoff) : utc(cutoff);
      for (let i = 0; i < maxBatches; i++) {
        const [, deleted] = await this.prisma.$transaction([
          this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${INFRA_SNAPSHOT_RETENTION_STATEMENT_TIMEOUT}'`),
          this.prisma.$executeRaw`
            DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${column} < ${bound} LIMIT ${batch}::int)`,
        ]);
        result[t.key] += deleted;
        if (deleted < batch) break;
      }
    }
    return result;
  }

  async hasClosedMonth(month: Date): Promise<boolean> {
    const row = await this.prisma.infraCostMonth.findUnique({ where: { month: monthDay(month) }, select: { month: true } });
    return row !== null;
  }

  /**
   * Mês primeiro com `ON CONFLICT DO NOTHING`: quem não inseriu não grava tenants (dois processos fechando o
   * mesmo mês não duplicam nem reescrevem). Mês e tenants na mesma transação.
   */
  async saveClosedMonth(closed: InfraCostClosedMonth): Promise<boolean> {
    const month = monthDay(closed.month);
    const fx = closed.fx;
    return this.prisma.$transaction(async (tx) => {
      const inserted = await tx.$executeRaw`
        INSERT INTO "infra_cost_months" ("month", "closingMethod", "fxRate", "fxReferenceDate", "fxSource", "totalUsd", "totals")
        VALUES (${utcDay(month)}, ${closed.closingMethod}, ${fx ? fx.rate.toFixed(4) : null}::numeric,
          ${fx ? utcDay(fx.referenceDate) : null}, ${fx?.source ?? null}, ${closed.totalUsd.toFixed(4)}::numeric,
          ${JSON.stringify(closed.totals)}::jsonb)
        ON CONFLICT ("month") DO NOTHING`;
      if (inserted === 0) return false;
      if (closed.tenants.length > 0) {
        await tx.infraCostMonthTenant.createMany({
          data: closed.tenants.map((t) => ({
            month,
            tenantId: t.tenantId,
            planSlug: t.planSlug,
            contractedAvg: t.contractedAvg,
            sessionHours: t.sessionHours,
            sharedUsd: usd(t.sharedUsd),
            aiUsd: usd(t.aiUsd),
            totalUsd: usd(t.totalUsd),
          })),
        });
      }
      return true;
    });
  }

  async findClosedMonth(month: Date): Promise<InfraCostClosedMonthSummary | null> {
    const row = await this.prisma.infraCostMonth.findUnique({ where: { month: monthDay(month) } });
    if (!row) return null;
    return {
      month: row.month,
      closingMethod: row.closingMethod as InfraFxClosingMethod,
      fx:
        row.fxRate && row.fxReferenceDate && row.fxSource
          ? { rate: row.fxRate.toNumber(), referenceDate: row.fxReferenceDate, source: row.fxSource as 'override' | 'ptax' | 'sgs' }
          : null,
      totalUsd: row.totalUsd.toNumber(),
      totals: row.totals as Record<string, unknown>,
      closedAt: row.closedAt,
    };
  }

  async fxRatesBetween(start: Date, end: Date): Promise<InfraFxRateRecord[]> {
    const rows = await this.prisma.infraFxRate.findMany({
      where: { referenceDate: { gte: start, lt: end } },
      orderBy: { referenceDate: 'asc' },
    });
    return rows.map((r) => ({ referenceDate: r.referenceDate, rate: r.rate.toNumber(), source: r.source as InfraFxRateSource, fetchedAt: r.fetchedAt }));
  }
}
