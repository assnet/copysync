import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiProviderKind } from '../../../assistants/domain/enums/AiProviderKind';
import type {
  IInfraCostReportReader,
  InfraCostClosedMonthHistoryRow,
  InfraCostClosedMonthTenantRow,
  InfraCostOpenMonthTenantRow,
  InfraCostTenantPageQuery,
} from '../../domain/contracts/IInfraCostReportReader';
import type { InfraAiUsageRow } from '../../domain/services/infraCostCalculator';
import type { InfraFxClosingMethod } from '../../domain/services/infraCostSettings';
import { OPS_READ_STATEMENT_TIMEOUT } from './PrismaOpsMetricsSampleRepository';
import { translateInfraCostReadTimeout } from './infraCostReadTimeout';

const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
const day = (d: Date) => Prisma.sql`${d.toISOString().slice(0, 10)}::date`;

type OpenRow = { tenantId: string; tenantName: string; planSlug: string | null; connectedHours: number; contractedAvg: number };
type AiRow = { tenantId: string; kind: AiProviderKind; model: string; calls: number; inputTokens: number; outputTokens: number; missingTokenCalls: number };
type ClosedRow = {
  tenantId: string; tenantName: string; planSlug: string | null; contractedAvg: number; sessionHours: number;
  sharedUsd: number; aiUsd: number; totalUsd: number;
};
type MonthRow = {
  month: Date; closingMethod: string; fxRate: number | null; fxReferenceDate: Date | null; fxSource: string | null;
  totalUsd: number; totalIsPartial: boolean | null; closedAt: Date;
};
type PlanRow = { month: Date; planSlug: string | null; tenants: number; sharedUsd: number; aiUsd: number; totalUsd: number };

/** Filtro de plano na coluna `m."planSlug"` (`tenants` também tem `planSlug`: sempre qualificado). */
const planFilter = (planSlug: string | undefined) => (planSlug ? Prisma.sql`AND m."planSlug" = ${planSlug}` : Prisma.empty);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/**
 * Abas Por cliente e Histórico (COST-14/15). Cada consulta em transação curta com `statement_timeout` 2 s. Do
 * tenant só sai `id` e `name`. Mês aberto: mesma agregação de `PrismaInfraCostUsageReader` (contratadas médias,
 * plano do último dia), ordenada no SQL; IA só dos tenants da página.
 */
export class PrismaInfraCostReportReader implements IInfraCostReportReader {
  constructor(private readonly prisma: PrismaClient) {}

  pageOpenMonth(start: Date, end: Date, page: InfraCostTenantPageQuery) {
    return translateInfraCostReadTimeout(() => this.readOpenMonth(start, end, page));
  }

  private async readOpenMonth(start: Date, end: Date, page: InfraCostTenantPageQuery) {
    const rows = await this.inTimeout<OpenRow[]>(this.prisma.$queryRaw<OpenRow[]>`
      SELECT m."tenantId", t."name" AS "tenantName", m."planSlug", m."connectedHours", m."contractedAvg"
      FROM (
        SELECT "tenantId",
               (array_agg("planSlug" ORDER BY "day" DESC) FILTER (WHERE "planSlug" IS NOT NULL))[1] AS "planSlug",
               sum("connectedHours")::int AS "connectedHours",
               CASE WHEN sum("contractedSamples") > 0
                    THEN sum("contractedSessions")::float8 / sum("contractedSamples") ELSE 0 END AS "contractedAvg"
        FROM "tenant_session_hours"
        WHERE "day" >= ${day(start)} AND "day" < ${day(end)}
        GROUP BY "tenantId"
      ) m
      JOIN "tenants" t ON t."id" = m."tenantId"
      WHERE true ${planFilter(page.planSlug)}
      ORDER BY m."contractedAvg" DESC, m."tenantId"
      LIMIT ${page.limit} OFFSET ${page.offset}`);
    const ids = rows.map((r) => r.tenantId);
    const ai = ids.length === 0 ? [] : await this.inTimeout<AiRow[]>(this.prisma.$queryRaw<AiRow[]>`
      SELECT "tenantId", "kind"::text AS "kind", "model",
             count(*)::int AS "calls",
             coalesce(sum("inputTokens") FILTER (WHERE "inputTokens" IS NOT NULL AND "outputTokens" IS NOT NULL), 0)::float8 AS "inputTokens",
             coalesce(sum("outputTokens") FILTER (WHERE "inputTokens" IS NOT NULL AND "outputTokens" IS NOT NULL), 0)::float8 AS "outputTokens",
             (count(*) FILTER (WHERE "inputTokens" IS NULL OR "outputTokens" IS NULL))::int AS "missingTokenCalls"
      FROM "ai_usage_logs"
      WHERE "tenantId" IN (${Prisma.join(ids)}) AND "source" = 'PLATFORM' AND "success" = true
        AND "createdAt" >= ${utc(start)} AND "createdAt" < ${utc(end)}
      GROUP BY "tenantId", "kind", "model"
      ORDER BY "tenantId", "kind", "model"`);
    return {
      rows: rows.map((r): InfraCostOpenMonthTenantRow => ({
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        planSlug: r.planSlug,
        connectedHours: Number(r.connectedHours),
        contractedAvg: Number(r.contractedAvg),
      })),
      aiUsage: ai.map((r): InfraAiUsageRow => ({
        tenantId: r.tenantId,
        kind: r.kind,
        model: r.model,
        calls: Number(r.calls),
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        missingTokenCalls: Number(r.missingTokenCalls),
      })),
    };
  }

  pageClosedMonth(month: Date, page: InfraCostTenantPageQuery): Promise<InfraCostClosedMonthTenantRow[]> {
    return translateInfraCostReadTimeout(() => this.readClosedMonth(month, page));
  }

  private async readClosedMonth(month: Date, page: InfraCostTenantPageQuery): Promise<InfraCostClosedMonthTenantRow[]> {
    const rows = await this.inTimeout<ClosedRow[]>(this.prisma.$queryRaw<ClosedRow[]>`
      SELECT m."tenantId", t."name" AS "tenantName", m."planSlug", m."contractedAvg", m."sessionHours",
             m."sharedUsd"::float8 AS "sharedUsd", m."aiUsd"::float8 AS "aiUsd", m."totalUsd"::float8 AS "totalUsd"
      FROM "infra_cost_month_tenants" m
      JOIN "tenants" t ON t."id" = m."tenantId"
      WHERE m."month" = ${day(month)} ${planFilter(page.planSlug)}
      ORDER BY m."totalUsd" DESC, m."tenantId"
      LIMIT ${page.limit} OFFSET ${page.offset}`);
    return rows.map((r) => ({
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      planSlug: r.planSlug,
      contractedAvg: Number(r.contractedAvg),
      sessionHours: Number(r.sessionHours),
      sharedUsd: Number(r.sharedUsd),
      aiUsd: Number(r.aiUsd),
      totalUsd: Number(r.totalUsd),
    }));
  }

  listClosedMonths(start: Date, end: Date): Promise<InfraCostClosedMonthHistoryRow[]> {
    return translateInfraCostReadTimeout(() => this.readHistory(start, end));
  }

  private async readHistory(start: Date, end: Date): Promise<InfraCostClosedMonthHistoryRow[]> {
    const [, months, plans] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${OPS_READ_STATEMENT_TIMEOUT}'`),
      this.prisma.$queryRaw<MonthRow[]>`
        SELECT "month", "closingMethod", "fxRate"::float8 AS "fxRate", "fxReferenceDate", "fxSource",
               "totalUsd"::float8 AS "totalUsd",
               CASE WHEN jsonb_typeof("totals"->'calculation'->'totalIsPartial') = 'boolean'
                    THEN ("totals"->'calculation'->>'totalIsPartial')::boolean END AS "totalIsPartial",
               "closedAt"
        FROM "infra_cost_months"
        WHERE "month" >= ${day(start)} AND "month" < ${day(end)}
        ORDER BY "month"`,
      this.prisma.$queryRaw<PlanRow[]>`
        SELECT "month", "planSlug", count(*)::int AS "tenants",
               sum("sharedUsd")::float8 AS "sharedUsd", sum("aiUsd")::float8 AS "aiUsd", sum("totalUsd")::float8 AS "totalUsd"
        FROM "infra_cost_month_tenants"
        WHERE "month" >= ${day(start)} AND "month" < ${day(end)}
        GROUP BY "month", "planSlug"
        ORDER BY "month", "planSlug" NULLS LAST`,
    ]);
    return months.map((m) => ({
      month: m.month,
      closingMethod: m.closingMethod as InfraFxClosingMethod,
      fx:
        m.fxRate !== null && m.fxReferenceDate && m.fxSource
          ? { rate: Number(m.fxRate), referenceDate: m.fxReferenceDate, source: m.fxSource as 'override' | 'ptax' | 'sgs' }
          : null,
      totalUsd: Number(m.totalUsd),
      totalIsPartial: m.totalIsPartial === true,
      closedAt: m.closedAt,
      plans: plans
        .filter((p) => monthKey(p.month) === monthKey(m.month))
        .map((p) => ({
          planSlug: p.planSlug,
          tenants: Number(p.tenants),
          sharedUsd: Number(p.sharedUsd),
          aiUsd: Number(p.aiUsd),
          totalUsd: Number(p.totalUsd),
        })),
    }));
  }

  /** Uma consulta com `statement_timeout` 2 s (transação curta). */
  private async inTimeout<T>(query: Prisma.PrismaPromise<T>): Promise<T> {
    const [, result] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${OPS_READ_STATEMENT_TIMEOUT}'`),
      query,
    ]);
    return result as T;
  }
}
