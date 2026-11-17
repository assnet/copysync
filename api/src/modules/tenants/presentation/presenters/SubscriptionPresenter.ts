import { PLAN_SLUGS, type PlanSlug } from '../../domain/planPresets';
import type { GetTenantSubscriptionOutput, SubscriptionProductOutput } from '../../application/dtos/TenantSubscriptionDto';
import { isKnownPlanSlug } from '../../domain/planCatalog';

/** Slug do tenant (`PLAN_SLUGS`) → slug da vitrine do painel (`app/src/features/plans/catalog.ts`). */
const CATALOG_SLUG: Record<PlanSlug, 'lite' | 'pro' | 'max'> = {
  COPYSYNC_LITE: 'lite',
  COPYSYNC_PRO: 'pro',
  COPYSYNC_MAX: 'max',
};

const isPlanSlug = (slug: string | null): slug is PlanSlug =>
  slug !== null && (PLAN_SLUGS as readonly string[]).includes(slug);

/** Tier da vitrine (`lite|pro|max`) de qualquer plano interno conhecido (`COPYSYNC_PRO`, `SAVER_PRO`). */
function tierOf(slug: string | null): 'lite' | 'pro' | 'max' | null {
  if (!slug || !isKnownPlanSlug(slug)) return null;
  const tier = slug.slice(slug.lastIndexOf('_') + 1).toLowerCase();
  return tier === 'lite' || tier === 'pro' || tier === 'max' ? tier : null;
}

function toProduct(p: SubscriptionProductOutput) {
  const known = p.planSlug && isKnownPlanSlug(p.planSlug) ? p.planSlug : null;
  return { product: p.product, planSlug: known, tier: tierOf(known), expiresAt: p.expiresAt?.toISOString() ?? null, source: p.source };
}

/** Resposta de `GET /subscription` (contrato em `.specs/features/subscription-page/spec.md`). */
export class SubscriptionPresenter {
  static toResponse(out: GetTenantSubscriptionOutput) {
    return {
      tenantName: out.tenantName,
      planSlug: isPlanSlug(out.planSlug) ? CATALOG_SLUG[out.planSlug] : null,
      status: out.status,
      suspendedAt: out.suspendedAt?.toISOString() ?? null,
      expiresAt: out.expiresAt?.toISOString() ?? null,
      limits: out.limits.map(({ key, channel, kind, used, limit, enabled, product }) => ({ key, channel, kind, used, limit, enabled, product })),
      products: (out.products ?? []).map(toProduct),
    };
  }
}
