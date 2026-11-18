import { Prisma } from '@prisma/client';
import type { IFeatureEligibilityReader } from '../../domain/contracts/IFeatureEligibilityReader';
import type { UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import { FEATURE_AUDIENCE_KEYS, type FeatureAudienceKey, parseFeatureAudience } from '../../../tenants/domain/featureAudience';
import { FEATURE_AUDIENCE_SETTINGS_KEY } from '../../../tenants/infrastructure/repositories/PrismaFeatureAudienceRepository';
import {
  type EligibilityAudience,
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
  internal: boolean | null;
  /** `platform_settings["feature_audience"]` (igual em toda linha: subconsulta sem correlação, avaliada uma vez). */
  audience: unknown;
};

/** Valor inicial da audiência por chave (env), lido a cada leitura. */
export type EligibilityAudienceDefaults = () => Record<FeatureAudienceKey, boolean>;
/** Sem valores iniciais injetados: o padrão das envs (`super_admin` = só super admin). */
const ALL_SUPER_ADMIN: EligibilityAudienceDefaults = () =>
  Object.fromEntries(FEATURE_AUDIENCE_KEYS.map((k) => [k, true])) as Record<FeatureAudienceKey, boolean>;

/**
 * Uma instrução para todas as contas: plano de Afiliados, linhas de `tenant_products` (por produto), só as chaves
 * de entitlement dos recursos pedidos, conta interna (membro super admin, como o diretório) e a audiência gravada.
 * Sem nome, sem e-mail. A decisão é do domínio (`featureEligibility.ts`).
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
           ${entitlements} AS "entitlements",
           EXISTS (
             SELECT 1 FROM "user_tenants" ut JOIN "users" u ON u."id" = ut."userId"
             WHERE ut."tenantId" = t."id" AND u."isSuperAdmin"
           ) AS "internal",
           (SELECT ps."value" FROM "platform_settings" ps WHERE ps."key" = ${FEATURE_AUDIENCE_SETTINGS_KEY}) AS "audience"
    FROM "tenants" t
    ORDER BY t."id"`;
}

export function toEligibilitySnapshot(raw: RawSnapshot): EligibilitySnapshot {
  return {
    tenantId: raw.tenantId,
    planSlug: raw.planSlug,
    products: raw.products ?? {},
    entitlements: raw.entitlements ?? {},
    internal: raw.internal === true,
  };
}

/** Audiência efetiva: gravada pelo admin, senão o valor inicial (mesma regra de `FeatureAudienceReader`). */
export function eligibilityAudienceOf(stored: unknown, defaults: EligibilityAudienceDefaults): EligibilityAudience {
  const saved = parseFeatureAudience(stored);
  const initial = defaults();
  return Object.fromEntries(FEATURE_AUDIENCE_KEYS.map((k) => [k, saved[k] ?? initial[k]]));
}

export class PrismaFeatureEligibilityReader implements IFeatureEligibilityReader {
  constructor(
    private readonly prisma: UsageReadPrisma,
    private readonly audienceDefaults: EligibilityAudienceDefaults = ALL_SUPER_ADMIN,
  ) {}

  async read(features: readonly FeatureUsageDefinition[], budget: UsageReadBudget): Promise<Map<string, Set<string>>> {
    if (features.length === 0) return new Map();
    const raw = await runWithinBudget<RawSnapshot>(budget, this.prisma, eligibilitySnapshotSql(entitlementKeysOf(features)));
    const audience = eligibilityAudienceOf(raw[0]?.audience, this.audienceDefaults);
    return eligibleTenantsByFeature(raw.map(toEligibilitySnapshot), features, audience);
  }
}
