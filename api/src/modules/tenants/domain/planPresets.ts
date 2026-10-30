import { ENTITLEMENT_KEYS } from './entitlementKeys';

export const PLAN_SLUGS = ['COPYSYNC_STARTER', 'COPYSYNC_PROFISSIONAL', 'COPYSYNC_BUSINESS'] as const;
export type PlanSlug = (typeof PLAN_SLUGS)[number];

/**
 * Entitlements por plano (`PlanEntitlementPreset`, seed). Espelha a tabela de `docs/produto-roadmap.md`
 * e os `limits` da vitrine (`app/src/features/plans/catalog.ts`); o teste ao lado trava os dois.
 * Numérico ausente = ilimitado; por isso `offer_generations_per_day` não entra (sem limite hoje).
 */
export const PLAN_PRESETS: Record<PlanSlug, Record<string, number | boolean>> = {
  COPYSYNC_STARTER: {
    [ENTITLEMENT_KEYS.WHATSAPP_SESSIONS]: 1,
    [ENTITLEMENT_KEYS.MONITORED_GROUPS]: 1,
    [ENTITLEMENT_KEYS.BROADCAST_GROUPS]: 5,
    [ENTITLEMENT_KEYS.MENTION_ALL_ENABLED]: false,
    [ENTITLEMENT_KEYS.MARKETPLACE_EXTENSION]: true,
    [ENTITLEMENT_KEYS.AI_REWRITE_ENABLED]: true,
    [ENTITLEMENT_KEYS.CROSS_SESSION_DISPATCH]: false,
    [ENTITLEMENT_KEYS.LINK_ROTATIONS]: 1,
    [ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS]: 3,
    [ENTITLEMENT_KEYS.STOREFRONT_ENABLED]: false,
    [ENTITLEMENT_KEYS.OFFER_STORY_ENABLED]: false,
  },
  COPYSYNC_PROFISSIONAL: {
    [ENTITLEMENT_KEYS.WHATSAPP_SESSIONS]: 1,
    [ENTITLEMENT_KEYS.MONITORED_GROUPS]: 2,
    [ENTITLEMENT_KEYS.BROADCAST_GROUPS]: 10,
    [ENTITLEMENT_KEYS.MENTION_ALL_ENABLED]: true,
    [ENTITLEMENT_KEYS.MARKETPLACE_EXTENSION]: true,
    [ENTITLEMENT_KEYS.AI_REWRITE_ENABLED]: true,
    [ENTITLEMENT_KEYS.CROSS_SESSION_DISPATCH]: false,
    [ENTITLEMENT_KEYS.LINK_ROTATIONS]: 1,
    [ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS]: 5,
    [ENTITLEMENT_KEYS.STOREFRONT_ENABLED]: true,
    [ENTITLEMENT_KEYS.OFFER_STORY_ENABLED]: false,
  },
  COPYSYNC_BUSINESS: {
    [ENTITLEMENT_KEYS.WHATSAPP_SESSIONS]: 2,
    [ENTITLEMENT_KEYS.MONITORED_GROUPS]: 6,
    [ENTITLEMENT_KEYS.BROADCAST_GROUPS]: 40,
    [ENTITLEMENT_KEYS.MENTION_ALL_ENABLED]: true,
    [ENTITLEMENT_KEYS.MARKETPLACE_EXTENSION]: true,
    [ENTITLEMENT_KEYS.AI_REWRITE_ENABLED]: true,
    [ENTITLEMENT_KEYS.CROSS_SESSION_DISPATCH]: true,
    [ENTITLEMENT_KEYS.LINK_ROTATIONS]: 2,
    [ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS]: 10,
    [ENTITLEMENT_KEYS.STOREFRONT_ENABLED]: true,
    [ENTITLEMENT_KEYS.OFFER_STORY_ENABLED]: true,
  },
};

/** Linhas para o seed (`planEntitlementPreset.upsert`). */
export function planPresetRows(): { planSlug: PlanSlug; key: string; value: number | boolean }[] {
  return PLAN_SLUGS.flatMap((planSlug) => Object.entries(PLAN_PRESETS[planSlug]).map(([key, value]) => ({ planSlug, key, value })));
}
