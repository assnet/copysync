import { Prisma, type PrismaClient } from '@prisma/client';
import type { IInfraCostUsageReader, InfraCostMonthUsage } from '../../domain/contracts/IInfraCostUsageReader';
import { INFRA_RENDER_KEYS, type InfraRenderKey } from '../../domain/services/infraCostSettings';
import { OPS_READ_STATEMENT_TIMEOUT } from './PrismaOpsMetricsSampleRepository';
import { translateInfraCostReadTimeout } from './infraCostReadTimeout';

/** ISO (UTC) → `timestamp` sem fuso, explícito: independe do `TimeZone` da sessão. */
const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
/** Dia UTC da data → `date`. */
const day = (d: Date) => Prisma.sql`${d.toISOString().slice(0, 10)}::date`;

type HourRow = { hour: Date; resourceKey: string; plan: string | null; instances: number; diskGb: number | null; suspended: boolean };
type UsageRow = { metric: string; total: number; hours: number };
type TenantRow = { tenantId: string; planSlug: string | null; connectedHours: number; contractedAvg: number };

const isRenderKey = (k: string): k is InfraRenderKey => (INFRA_RENDER_KEYS as readonly string[]).includes(k);

/**
 * Agregados do mês dos snapshots horários (T11). As três consultas na mesma transação com `statement_timeout`
 * 2 s. Contratadas médias = Σ `contractedSessions` ÷ Σ `contractedSamples` do mês (média por hora amostrada);
 * plano do tenant = o do último dia com plano no mês. Horas de banda = Σ por dia do maior `hours`
 * entre os serviços (hora com banda de algum serviço conta uma vez).
 */
export class PrismaInfraCostUsageReader implements IInfraCostUsageReader {
  constructor(private readonly prisma: PrismaClient) {}

  readMonth(start: Date, end: Date): Promise<InfraCostMonthUsage> {
    return translateInfraCostReadTimeout(() => this.query(start, end));
  }

  private async query(start: Date, end: Date): Promise<InfraCostMonthUsage> {
    const [, hours, usage, tenants] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${OPS_READ_STATEMENT_TIMEOUT}'`),
      this.prisma.$queryRaw<HourRow[]>`
        SELECT "hour", "resourceKey", "plan", "instances", "diskGb", "suspended"
        FROM "infra_resource_hours"
        WHERE "hour" >= ${utc(start)} AND "hour" < ${utc(end)}
        ORDER BY "hour", "resourceKey"`,
      this.prisma.$queryRaw<UsageRow[]>`
        SELECT "metric", sum("total")::float8 AS total, sum("hours")::int AS hours
        FROM (
          SELECT "metric", "day", sum("value") AS total, max("hours") AS hours
          FROM "infra_usage_daily"
          WHERE "day" >= ${day(start)} AND "day" < ${day(end)}
          GROUP BY "metric", "day"
        ) d
        GROUP BY "metric"`,
      this.prisma.$queryRaw<TenantRow[]>`
        SELECT "tenantId",
               (array_agg("planSlug" ORDER BY "day" DESC) FILTER (WHERE "planSlug" IS NOT NULL))[1] AS "planSlug",
               sum("connectedHours")::int AS "connectedHours",
               CASE WHEN sum("contractedSamples") > 0
                    THEN sum("contractedSessions")::float8 / sum("contractedSamples") ELSE 0 END AS "contractedAvg"
        FROM "tenant_session_hours"
        WHERE "day" >= ${day(start)} AND "day" < ${day(end)}
        GROUP BY "tenantId"
        ORDER BY "tenantId"`,
    ]);
    const total = (metric: string) => usage.find((u) => u.metric === metric)?.total ?? null;
    return {
      resourceHours: hours
        .filter((h) => isRenderKey(h.resourceKey))
        .map((h) => ({
          hour: h.hour,
          renderKey: h.resourceKey as InfraRenderKey,
          plan: h.plan,
          instances: h.instances,
          diskGb: h.diskGb,
          suspended: h.suspended,
        })),
      bandwidthGb: total('bandwidth_gb'),
      bandwidthHours: Number(usage.find((u) => u.metric === 'bandwidth_gb')?.hours ?? 0),
      buildMinutes: total('build_minutes'),
      tenants: tenants.map((t) => ({
        tenantId: t.tenantId,
        planSlug: t.planSlug,
        connectedHours: Number(t.connectedHours),
        contractedAvg: Number(t.contractedAvg),
      })),
    };
  }
}
