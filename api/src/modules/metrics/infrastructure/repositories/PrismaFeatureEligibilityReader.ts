import { Prisma } from '@prisma/client';
import type { IFeatureEligibilityReader } from '../../domain/contracts/IFeatureEligibilityReader';
import type { UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import {
  type EligibilityProductRow,
  type EligibilitySnapshot,
  eligibleTenantsByFeature,
  entitlementKeysOf,
} from '../../domain/services/featureEligibility';
import type { FeatureUsageDefinition } from '../../domain/services/featureUsageCatalog';
import { runWithinBudget, type UsageReadPrisma } from './featureUsageReadTimeout';

type RawSnapshot = {
  tenantId: string;
  planSlug: string | null;
  products: Record<string, EligibilityProductRow> | null;
  entitlements: Record<string, unknown> | null;
};

/**
 * Uma instrução para todas as contas: plano de Afiliados, linhas de `tenant_products` (por produto) e só as chaves
 * de entitlement dos recursos pedidos. Sem nome, sem e-mail. A decisão é do domínio (`featureEligibility.ts`).
 */
export function eligibilitySnapshotSql(keys: readonly string[]): Prisma.Sql {
  const entitlements =
    keys.length === 0
      ? Prisma.sql`'{}'::jsonb`
      : Prisma.sql`(SELECT jsonb_object_agg(e."key", e."value") FROM "tenant_entitlements" e
                    WHERE e."tenantId" = t."id" AND e."key" IN (${Prisma.join([...keys])}))`;
  return Prisma.sql`
    SELECT t."id" AS "tenantId", t."planSlug",
           (SELECT jsonb_object_agg(p."product", jsonb_build_object('status', p."status", 'planSlug', p."planSlug"))
              FROM "tenant_products" p WHERE p."tenantId" = t."id") AS "products",
           ${entitlements} AS "entitlements"
    FROM "tenants" t
    ORDER BY t."id"`;
}

export function toEligibilitySnapshot(raw: RawSnapshot): EligibilitySnapshot {
  return {
    tenantId: raw.tenantId,
    planSlug: raw.planSlug,
    products: raw.products ?? {},
    entitlements: raw.entitlements ?? {},
  };
}

export class PrismaFeatureEligibilityReader implements IFeatureEligibilityReader {
  constructor(private readonly prisma: UsageReadPrisma) {}

  async read(features: readonly FeatureUsageDefinition[], budget: UsageReadBudget): Promise<Map<string, Set<string>>> {
    if (features.length === 0) return new Map();
    const raw = await runWithinBudget<RawSnapshot>(budget, this.prisma, eligibilitySnapshotSql(entitlementKeysOf(features)));
    return eligibleTenantsByFeature(raw.map(toEligibilitySnapshot), features);
  }
}
