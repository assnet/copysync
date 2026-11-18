import { Prisma } from '@prisma/client';
import type { IPageViewReader, PageViewRow, PageViewScope } from '../../domain/contracts/IPageViewReader';
import type { UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import { SCREEN_VIEW_KEYS } from '../../domain/services/screenViewCatalog';
import { runWithinBudget, type UsageReadPrisma } from './featureUsageReadTimeout';

/**
 * Ranking das telas direto do agregado (P3): `GROUP BY "featureKey"` no SQL, contas distintas e pares dia × conta
 * por tela, com o recorte de contas de cada família. Uma linha por tela; nenhum `tenantId` sai da consulta.
 */
export function pageViewRankingSql(fromDay: string, toDayExclusive: string, scopes: readonly PageViewScope[]): Prisma.Sql | null {
  const parts = scopes
    .filter((s) => s.keys.length > 0 && s.tenantIds.length > 0)
    .map((s) => Prisma.sql`("featureKey" IN (${Prisma.join([...s.keys])}) AND "tenantId" = ANY(${[...s.tenantIds]}::text[]))`);
  if (parts.length === 0) return null;
  return Prisma.sql`
    SELECT "featureKey" AS key, count(DISTINCT "tenantId")::int AS tenants, count(*)::int AS "tenantDays"
    FROM "feature_usage_daily"
    WHERE "day" >= ${fromDay}::date AND "day" < ${toDayExclusive}::date AND "kind" = 'ACCESS'
      AND (${Prisma.join(parts, ' OR ')})
    GROUP BY "featureKey"`;
}

export class PrismaPageViewReader implements IPageViewReader {
  constructor(private readonly prisma: UsageReadPrisma) {}

  async read(
    input: { fromDay: string; toDayExclusive: string; scopes: readonly PageViewScope[] },
    budget: UsageReadBudget,
  ): Promise<{ rows: PageViewRow[]; firstDataDay: string | null }> {
    const sql = pageViewRankingSql(input.fromDay, input.toDayExclusive, input.scopes);
    const raw = sql ? await runWithinBudget<PageViewRow>(budget, this.prisma, sql) : [];
    const [first] = await runWithinBudget<{ first: string | null }>(
      budget,
      this.prisma,
      Prisma.sql`SELECT to_char(MIN("day"), 'YYYY-MM-DD') AS first FROM "feature_usage_daily"
                 WHERE "featureKey" IN (${Prisma.join([...SCREEN_VIEW_KEYS])})`,
    );
    return {
      rows: raw.map((r) => ({ key: r.key, tenants: Number(r.tenants), tenantDays: Number(r.tenantDays) })),
      firstDataDay: first?.first ?? null,
    };
  }
}
