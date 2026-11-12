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

type OpenRow = { tenantId: string; tenantName: string; sortKey: string; planSlug: string | null; connectedHours: number; contractedAvg: number };
type AiRow = { tenantId: string; kind: AiProviderKind; model: string; calls: number; inputTokens: number; outputTokens: number; missingTokenCalls: number };
type ClosedRow = {
  tenantId: string; tenantName: string; planSlug: string | null; contractedAvg: number; sessionHours: number;
  sharedUsd: number; aiUsd: number; totalUsd: number; sortKey: string;
};
type MonthRow = {
  month: Date; closingMethod: string; fxRate: number | null; fxReferenceDate: Date | null; fxSource: string | null;
  totalUsd: number; totalIsPartial: boolean | null; unallocatedUsd: number; excludedUsd: number; closedAt: Date;
};
type PlanRow = { month: Date; planSlug: string | null; tenants: number; sharedUsd: number; aiUsd: number; totalUsd: number };

/** Filtro de plano na coluna `m."planSlug"` (`tenants` também tem `planSlug`: sempre qualificado). */
const planFilter = (planSlug: string | undefined) => (planSlug ? Prisma.sql`AND m."planSlug" = ${planSlug}` : Prisma.empty);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);
/** `totalUsd desc, tenantId asc` (direções mistas): sem comparação de linha. `sortKey` = texto do `numeric`. */
const closedAfter = (after: { sortKey: string; tenantId: string }) => Prisma.sql`
  AND (m."totalUsd" < ${after.sortKey}::numeric OR (m."totalUsd" = ${after.sortKey}::numeric AND m."tenantId" > ${after.tenantId}))`;
/** Campo numérico de `totals.allocation` (nome fixo, nunca entrada); ausente/ilegível = 0. */
const jsonUsd = (field: 'unallocatedUsd' | 'excludedUsd') => Prisma.raw(
  `CASE WHEN jsonb_typeof("totals"->'allocation'->'${field}') = 'number' THEN ("totals"->'allocation'->>'${field}')::float8 ELSE 0 END`,
);

/**
 * Abas Por cliente e Histórico (COST-14/15). Cada consulta em transação curta com `statement_timeout` 2 s. Do
 * tenant só sai `id` e `name`. Mês aberto: mesma agregação de `PrismaInfraCostUsageReader` (contratadas médias,
 * plano do último dia), ordem `lower(name), tenantId` no SQL; IA só dos tenants da página. Páginas por keyset
 * (`after`), nunca offset: a ordem não muda entre uma página e a seguinte.
 */
export class PrismaInfraCostReportReader implements IInfraCostReportReader {
  constructor(private readonly prisma: PrismaClient) {}

  pageOpenMonth(start: Date, end: Date, page: InfraCostTenantPageQuery) {
    return translateInfraCostReadTimeout(() => this.readOpenMonth(start, end, page));
  }

  private async readOpenMonth(start: Date, end: Date, page: InfraCostTenantPageQuery) {
    const rows = await this.inTimeout<OpenRow[]>(this.prisma.$queryRaw<OpenRow[]>`
      SELECT m."tenantId", t."name" AS "tenantName", lower(t."name") AS "sortKey", m."planSlug", m."connectedHours", m."contractedAvg"
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
        ${page.after ? Prisma.sql`AND (lower(t."name"), m."tenantId") > (${page.after.sortKey}, ${page.after.tenantId})` : Prisma.empty}
      ORDER BY lower(t."name"), m."tenantId"
      LIMIT ${page.limit}`);
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
        sortKey: r.sortKey,
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
             m."sharedUsd"::float8 AS "sharedUsd", m."aiUsd"::float8 AS "aiUsd", m."totalUsd"::float8 AS "totalUsd",
             m."totalUsd"::text AS "sortKey"
      FROM "infra_cost_month_tenants" m
      JOIN "tenants" t ON t."id" = m."tenantId"
      WHERE m."month" = ${day(month)} ${planFilter(page.planSlug)}
        ${page.after ? closedAfter(page.after) : Prisma.empty}
      ORDER BY m."totalUsd" DESC, m."tenantId"
      LIMIT ${page.limit}`);
    return rows.map((r) => ({
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      planSlug: r.planSlug,
      contractedAvg: Number(r.contractedAvg),
      sessionHours: Number(r.sessionHours),
      sharedUsd: Number(r.sharedUsd),
      aiUsd: Number(r.aiUsd),
      totalUsd: Number(r.totalUsd),
      sortKey: r.sortKey,
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
               ${jsonUsd('unallocatedUsd')} AS "unallocatedUsd", ${jsonUsd('excludedUsd')} AS "excludedUsd",
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
      unallocatedUsd: Number(m.unallocatedUsd),
      excludedUsd: Number(m.excludedUsd),
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
