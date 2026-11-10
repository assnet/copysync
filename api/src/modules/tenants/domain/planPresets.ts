import { ENTITLEMENT_KEYS } from './entitlementKeys';

export const PLAN_SLUGS = ['COPYSYNC_LITE', 'COPYSYNC_PRO', 'COPYSYNC_MAX'] as const;
export type PlanSlug = (typeof PLAN_SLUGS)[number];

const TIER_SLUG: Record<string, PlanSlug> = { lite: 'COPYSYNC_LITE', pro: 'COPYSYNC_PRO', max: 'COPYSYNC_MAX' };
const BILLING_OFFER_SLUG = /^copysync-(lite|pro|max)-(mensal|anual)$/;
const BILLING_TEST_OFFER_SLUGS = new Set(['afiliado-dev-anual', 'copysync-dev-anual']);

/**
 * `planSlug` vindo da central → slug do tenant. A central envia o slug da oferta
 * (`copysync-{lite|pro|max}-{mensal|anual}`); o período não muda limites, então mensal e anual
 * resolvem o mesmo preset. A oferta de teste DEV (slugs atual e histórico) usa Business.
 * Aceita também o slug interno (`COPYSYNC_*`) por compatibilidade.
 * Desconhecido = `null`.
 */
export function resolvePlanSlug(raw: string | null | undefined): PlanSlug | null {
  if (!raw) return null;
  const value = raw.trim();
  if ((PLAN_SLUGS as readonly string[]).includes(value)) return value as PlanSlug;
  const offerSlug = value.toLowerCase();
  if (BILLING_TEST_OFFER_SLUGS.has(offerSlug)) return 'COPYSYNC_MAX';
  const match = BILLING_OFFER_SLUG.exec(offerSlug);
  return match ? TIER_SLUG[match[1]] : null;
}

/**
 * Entitlements por plano (`PlanEntitlementPreset`, seed). Espelha a tabela de `docs/produto-roadmap.md`
 * e os `limits` da vitrine (`app/src/features/plans/catalog.ts`); o teste ao lado trava os dois.
 * `null` = ilimitado (só chave numérica): grava JSON null explícito, senão o upgrade herdaria o limite
 * do plano anterior (o sync só faz upsert das chaves do preset). Ex.: `offer_generations_per_day` no MAX.
 * `offer_generations_per_day` é limite interno, fora da vitrine.
 */
export type PlanPresetValue = number | boolean | null;

export const PLAN_PRESETS: Record<PlanSlug, Record<string, PlanPresetValue>> = {
  COPYSYNC_LITE: {
    [ENTITLEMENT_KEYS.WHATSAPP_SESSIONS]: 1,
    [ENTITLEMENT_KEYS.TELEGRAM_SESSIONS]: 0,
    [ENTITLEMENT_KEYS.MONITORED_GROUPS]: 1,
    [ENTITLEMENT_KEYS.BROADCAST_GROUPS]: 5,
    [ENTITLEMENT_KEYS.TELEGRAM_MONITORED_GROUPS]: 0,
    [ENTITLEMENT_KEYS.TELEGRAM_BROADCAST_GROUPS]: 0,
    [ENTITLEMENT_KEYS.MENTION_ALL_ENABLED]: false,
    [ENTITLEMENT_KEYS.MARKETPLACE_EXTENSION]: true,
    [ENTITLEMENT_KEYS.AI_REWRITE_ENABLED]: false,
    [ENTITLEMENT_KEYS.CROSS_SESSION_DISPATCH]: false,
    [ENTITLEMENT_KEYS.LINK_ROTATIONS]: 1,
    [ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS]: 3,
    [ENTITLEMENT_KEYS.TELEGRAM_LINK_ROTATIONS]: 0,
    [ENTITLEMENT_KEYS.TELEGRAM_LINK_ROTATION_GROUPS]: 0,
    [ENTITLEMENT_KEYS.STOREFRONT_ENABLED]: false,
    [ENTITLEMENT_KEYS.OFFER_STORY_ENABLED]: false,
    [ENTITLEMENT_KEYS.ENRICH_LINK_ONLY_ENABLED]: false,
    [ENTITLEMENT_KEYS.CAPTURE_OUTSIDE_WINDOW_ENABLED]: false,
    [ENTITLEMENT_KEYS.OFFER_GENERATIONS_PER_DAY]: 5,
  },
  COPYSYNC_PRO: {
    [ENTITLEMENT_KEYS.WHATSAPP_SESSIONS]: 1,
    [ENTITLEMENT_KEYS.TELEGRAM_SESSIONS]: 1,
    [ENTITLEMENT_KEYS.MONITORED_GROUPS]: 2,
    [ENTITLEMENT_KEYS.BROADCAST_GROUPS]: 10,
    [ENTITLEMENT_KEYS.TELEGRAM_MONITORED_GROUPS]: 2,
    [ENTITLEMENT_KEYS.TELEGRAM_BROADCAST_GROUPS]: 10,
    [ENTITLEMENT_KEYS.MENTION_ALL_ENABLED]: true,
    [ENTITLEMENT_KEYS.MARKETPLACE_EXTENSION]: true,
    [ENTITLEMENT_KEYS.AI_REWRITE_ENABLED]: true,
    [ENTITLEMENT_KEYS.CROSS_SESSION_DISPATCH]: false,
    [ENTITLEMENT_KEYS.LINK_ROTATIONS]: 1,
    [ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS]: 5,
    [ENTITLEMENT_KEYS.TELEGRAM_LINK_ROTATIONS]: 1,
    [ENTITLEMENT_KEYS.TELEGRAM_LINK_ROTATION_GROUPS]: 5,
    [ENTITLEMENT_KEYS.STOREFRONT_ENABLED]: true,
    [ENTITLEMENT_KEYS.OFFER_STORY_ENABLED]: false,
    [ENTITLEMENT_KEYS.ENRICH_LINK_ONLY_ENABLED]: true,
    [ENTITLEMENT_KEYS.CAPTURE_OUTSIDE_WINDOW_ENABLED]: false,
    [ENTITLEMENT_KEYS.OFFER_GENERATIONS_PER_DAY]: 20,
  },
  COPYSYNC_MAX: {
    [ENTITLEMENT_KEYS.WHATSAPP_SESSIONS]: 2,
    [ENTITLEMENT_KEYS.TELEGRAM_SESSIONS]: 2,
    [ENTITLEMENT_KEYS.MONITORED_GROUPS]: 6,
    [ENTITLEMENT_KEYS.BROADCAST_GROUPS]: 40,
    [ENTITLEMENT_KEYS.TELEGRAM_MONITORED_GROUPS]: 6,
    [ENTITLEMENT_KEYS.TELEGRAM_BROADCAST_GROUPS]: 40,
    [ENTITLEMENT_KEYS.MENTION_ALL_ENABLED]: true,
    [ENTITLEMENT_KEYS.MARKETPLACE_EXTENSION]: true,
    [ENTITLEMENT_KEYS.AI_REWRITE_ENABLED]: true,
    [ENTITLEMENT_KEYS.CROSS_SESSION_DISPATCH]: true,
    [ENTITLEMENT_KEYS.LINK_ROTATIONS]: 2,
    [ENTITLEMENT_KEYS.LINK_ROTATION_GROUPS]: 10,
    [ENTITLEMENT_KEYS.TELEGRAM_LINK_ROTATIONS]: 2,
    [ENTITLEMENT_KEYS.TELEGRAM_LINK_ROTATION_GROUPS]: 10,
    [ENTITLEMENT_KEYS.STOREFRONT_ENABLED]: true,
    [ENTITLEMENT_KEYS.OFFER_STORY_ENABLED]: true,
    [ENTITLEMENT_KEYS.ENRICH_LINK_ONLY_ENABLED]: true,
    [ENTITLEMENT_KEYS.CAPTURE_OUTSIDE_WINDOW_ENABLED]: true,
    [ENTITLEMENT_KEYS.OFFER_GENERATIONS_PER_DAY]: null,
  },
};

/** Linhas para o seed (`planEntitlementPreset.upsert`). */
export function planPresetRows(): { planSlug: PlanSlug; key: string; value: PlanPresetValue }[] {
  return PLAN_SLUGS.flatMap((planSlug) => Object.entries(PLAN_PRESETS[planSlug]).map(([key, value]) => ({ planSlug, key, value })));
}
