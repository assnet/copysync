import { ENTITLEMENT_KEYS } from './entitlementKeys';

export const PLAN_SLUGS = ['COPYSYNC_LITE', 'COPYSYNC_PRO', 'COPYSYNC_MAX'] as const;
export type PlanSlug = (typeof PLAN_SLUGS)[number];

/**
 * Planos do produto Saver. Fora de `PLAN_SLUGS` de propósito: a ordenação de tier da reconciliação
 * (Afiliados) não muda. A resolução produto/plano fica em `planCatalog.ts`.
 */
export const SAVER_PLAN_SLUGS = ['SAVER_LITE', 'SAVER_PRO', 'SAVER_MAX'] as const;
export type SaverPlanSlug = (typeof SAVER_PLAN_SLUGS)[number];

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
 * Permissão do snapshot da assinatura → nível. As chaves são as mesmas dos slugs internos;
 * a ordem de `PLAN_SLUGS` (LITE < PRO < MAX) define qual vence.
 */
const PERMISSION_LEVEL: Record<string, PlanSlug> = Object.fromEntries(PLAN_SLUGS.map((slug) => [slug, slug]));

/**
 * Nível efetivo do tenant a partir do evento da central. O snapshot de cada plano já traz a
 * permissão do próprio nível (`seed-application-copysync.ts:176` na central), então a permissão
 * é o caminho normal e o slug é o fallback: vence a permissão reconhecida mais alta; nenhuma
 * reconhecida → `resolvePlanSlug(planSlug)`. Permissão desconhecida é ignorada (o log fica com
 * quem chama).
 */
export function resolveEffectivePlanSlug(
  planSlug: string | null | undefined,
  permissions: readonly string[] | null | undefined,
): PlanSlug | null {
  let best = -1;
  for (const raw of permissions ?? []) {
    const level = typeof raw === 'string' ? PERMISSION_LEVEL[raw.trim()] : undefined;
    if (level) best = Math.max(best, PLAN_SLUGS.indexOf(level));
  }
  return best >= 0 ? PLAN_SLUGS[best] : resolvePlanSlug(planSlug);
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
    [ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED]: false,
    [ENTITLEMENT_KEYS.MARKETPLACE_KABUM_ENABLED]: false,
    [ENTITLEMENT_KEYS.MARKETPLACE_MAGALU_ENABLED]: false,
    [ENTITLEMENT_KEYS.MARKETPLACE_ALIEXPRESS_ENABLED]: false,
    [ENTITLEMENT_KEYS.OFFER_CLEAN_IMAGE_ENABLED]: false,
    [ENTITLEMENT_KEYS.OFFER_WATERMARK_ENABLED]: false,
    [ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS]: 1,
    [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]: false,
    [ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY]: 0,
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
    [ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED]: false,
    [ENTITLEMENT_KEYS.MARKETPLACE_KABUM_ENABLED]: false,
    [ENTITLEMENT_KEYS.MARKETPLACE_MAGALU_ENABLED]: false,
    [ENTITLEMENT_KEYS.MARKETPLACE_ALIEXPRESS_ENABLED]: false,
    [ENTITLEMENT_KEYS.OFFER_CLEAN_IMAGE_ENABLED]: true,
    [ENTITLEMENT_KEYS.OFFER_WATERMARK_ENABLED]: false,
    [ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS]: 2,
    [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]: false,
    [ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY]: 0,
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
    [ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED]: true,
    [ENTITLEMENT_KEYS.MARKETPLACE_KABUM_ENABLED]: true,
    [ENTITLEMENT_KEYS.MARKETPLACE_MAGALU_ENABLED]: true,
    [ENTITLEMENT_KEYS.MARKETPLACE_ALIEXPRESS_ENABLED]: true,
    [ENTITLEMENT_KEYS.OFFER_CLEAN_IMAGE_ENABLED]: true,
    [ENTITLEMENT_KEYS.OFFER_WATERMARK_ENABLED]: true,
    [ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS]: 10,
    [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]: true,
    [ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY]: 10,
    [ENTITLEMENT_KEYS.OFFER_GENERATIONS_PER_DAY]: null,
  },
};

/**
 * Presets do Saver (`.specs/features/saver/design.md` §2.1). `null` explícito = ilimitado: no Saver a
 * chave ausente vale 0, então omitir quebraria o MAX. As compartilhadas (`whatsapp_sessions`,
 * `telegram_sessions`) ficam aqui para o merge entre produtos (`sharedEntitlements.ts`); o sync do plano
 * Saver as exclui. `telegram_sessions: 0` é obrigatório (ausente = ilimitado nas sessões).
 */
export const SAVER_PLAN_PRESETS: Record<SaverPlanSlug, Record<string, PlanPresetValue>> = {
  SAVER_LITE: {
    [ENTITLEMENT_KEYS.WHATSAPP_SESSIONS]: 1,
    [ENTITLEMENT_KEYS.TELEGRAM_SESSIONS]: 0,
    [ENTITLEMENT_KEYS.SAVER_GROUPS]: 10,
    [ENTITLEMENT_KEYS.SAVER_CONTACTS]: 10_000,
    [ENTITLEMENT_KEYS.SAVER_GROUP_SCANS_PER_DAY]: 20,
    [ENTITLEMENT_KEYS.SAVER_AUTO_REFRESH_ENABLED]: false,
  },
  SAVER_PRO: {
    [ENTITLEMENT_KEYS.WHATSAPP_SESSIONS]: 1,
    [ENTITLEMENT_KEYS.TELEGRAM_SESSIONS]: 0,
    [ENTITLEMENT_KEYS.SAVER_GROUPS]: 50,
    [ENTITLEMENT_KEYS.SAVER_CONTACTS]: 50_000,
    [ENTITLEMENT_KEYS.SAVER_GROUP_SCANS_PER_DAY]: 100,
    [ENTITLEMENT_KEYS.SAVER_AUTO_REFRESH_ENABLED]: true,
  },
  SAVER_MAX: {
    [ENTITLEMENT_KEYS.WHATSAPP_SESSIONS]: 2,
    [ENTITLEMENT_KEYS.TELEGRAM_SESSIONS]: 0,
    [ENTITLEMENT_KEYS.SAVER_GROUPS]: null,
    [ENTITLEMENT_KEYS.SAVER_CONTACTS]: null,
    [ENTITLEMENT_KEYS.SAVER_GROUP_SCANS_PER_DAY]: 500,
    [ENTITLEMENT_KEYS.SAVER_AUTO_REFRESH_ENABLED]: true,
  },
};

/** Preset de qualquer plano interno conhecido (Afiliados ou Saver); desconhecido = `undefined`. */
export function presetOf(planSlug: string): Readonly<Record<string, PlanPresetValue>> | undefined {
  if ((PLAN_SLUGS as readonly string[]).includes(planSlug)) return PLAN_PRESETS[planSlug as PlanSlug];
  if ((SAVER_PLAN_SLUGS as readonly string[]).includes(planSlug)) return SAVER_PLAN_PRESETS[planSlug as SaverPlanSlug];
  return undefined;
}

/** Linhas para o seed (`planEntitlementPreset.upsert`): Afiliados e Saver. */
export function planPresetRows(): { planSlug: PlanSlug | SaverPlanSlug; key: string; value: PlanPresetValue }[] {
  return [
    ...PLAN_SLUGS.flatMap((planSlug) => Object.entries(PLAN_PRESETS[planSlug]).map(([key, value]) => ({ planSlug, key, value }))),
    ...SAVER_PLAN_SLUGS.flatMap((planSlug) => Object.entries(SAVER_PLAN_PRESETS[planSlug]).map(([key, value]) => ({ planSlug, key, value }))),
  ];
}
