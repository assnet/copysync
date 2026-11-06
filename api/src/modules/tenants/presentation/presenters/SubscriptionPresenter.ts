import { PLAN_SLUGS, type PlanSlug } from '../../domain/planPresets';
import type { GetTenantSubscriptionOutput } from '../../application/dtos/TenantSubscriptionDto';

/** Slug do tenant (`PLAN_SLUGS`) → slug da vitrine do painel (`app/src/features/plans/catalog.ts`). */
const CATALOG_SLUG: Record<PlanSlug, 'lite' | 'pro' | 'max'> = {
  COPYSYNC_LITE: 'lite',
  COPYSYNC_PRO: 'pro',
  COPYSYNC_MAX: 'max',
};

const isPlanSlug = (slug: string | null): slug is PlanSlug =>
  slug !== null && (PLAN_SLUGS as readonly string[]).includes(slug);

/** Resposta de `GET /subscription` (contrato em `.specs/features/subscription-page/spec.md`). */
export class SubscriptionPresenter {
  static toResponse(out: GetTenantSubscriptionOutput) {
    return {
      tenantName: out.tenantName,
      planSlug: isPlanSlug(out.planSlug) ? CATALOG_SLUG[out.planSlug] : null,
      status: out.status,
      suspendedAt: out.suspendedAt?.toISOString() ?? null,
      expiresAt: out.expiresAt?.toISOString() ?? null,
      limits: out.limits.map(({ key, channel, kind, used, limit, enabled }) => ({ key, channel, kind, used, limit, enabled })),
    };
  }
}
