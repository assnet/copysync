import { Prisma } from '@prisma/client';
import type { UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import type { IUsageTenantDirectory, UsageTenantDirectoryEntry } from '../../domain/contracts/IUsageTenantDirectory';
import { NO_PLAN, type UsageTenantStatus } from '../../domain/services/aggregateFeatureUsage';
import {
  resolveProductAccess,
  type ProductAccessRow,
  type TenantProductStatus,
} from '../../../tenants/domain/services/resolveProductAccess';
import { runWithinBudget, type UsageReadPrisma } from './featureUsageReadTimeout';

type DirectoryRow = {
  tenantId: string;
  planSlug: string | null;
  status: UsageTenantStatus;
  createdAt: Date;
  internal: boolean;
  affiliatesStatus: TenantProductStatus | null;
  saverStatus: TenantProductStatus | null;
  saverPlanSlug: string | null;
};

/** Contas + conta interna (algum membro super admin) + linhas de produto. Sem `name`. */
export const USAGE_TENANT_LIST_SQL = Prisma.sql`
  SELECT t."id" AS "tenantId", t."planSlug", t."status"::text AS "status", t."createdAt",
         EXISTS (
           SELECT 1 FROM "user_tenants" ut JOIN "users" u ON u."id" = ut."userId"
           WHERE ut."tenantId" = t."id" AND u."isSuperAdmin"
         ) AS "internal",
         aff."status" AS "affiliatesStatus",
         sav."status" AS "saverStatus", sav."planSlug" AS "saverPlanSlug"
  FROM "tenants" t
  LEFT JOIN "tenant_products" aff ON aff."tenantId" = t."id" AND aff."product" = 'AFFILIATES'
  LEFT JOIN "tenant_products" sav ON sav."tenantId" = t."id" AND sav."product" = 'SAVER'
  ORDER BY t."id"`;

const accessRow = (status: TenantProductStatus | null): ProductAccessRow | null => (status ? { status } : null);

/**
 * Plano de cada família pela regra de acesso de `tenants` (design §4.2): `Tenant.planSlug` só com
 * Afiliados ativo (sobrevive ao cancelamento, sozinho não prova plano); Saver pela linha `SAVER`.
 */
export function toDirectoryEntry(row: DirectoryRow): UsageTenantDirectoryEntry {
  const affiliates = resolveProductAccess('AFFILIATES', accessRow(row.affiliatesStatus));
  const saver = resolveProductAccess('SAVER', accessRow(row.saverStatus));
  return {
    tenantId: row.tenantId,
    affiliatesPlan: affiliates && row.planSlug ? row.planSlug : NO_PLAN,
    saverPlan: saver && row.saverPlanSlug ? row.saverPlanSlug : NO_PLAN,
    status: row.status,
    internal: row.internal === true,
    createdAt: row.createdAt,
  };
}

export class PrismaUsageTenantDirectory implements IUsageTenantDirectory {
  constructor(private readonly prisma: UsageReadPrisma) {}

  async list(budget: UsageReadBudget): Promise<UsageTenantDirectoryEntry[]> {
    const rows = await runWithinBudget<DirectoryRow>(budget, this.prisma, USAGE_TENANT_LIST_SQL);
    return rows.map(toDirectoryEntry);
  }

  async names(ids: readonly string[], budget: UsageReadBudget): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await runWithinBudget<{ id: string; name: string }>(
      budget,
      this.prisma,
      Prisma.sql`SELECT "id", "name" FROM "tenants" WHERE "id" IN (${Prisma.join([...ids])})`,
    );
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
