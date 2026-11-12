import { ENTITLEMENT_KEYS, type EntitlementKey } from '../entitlementKeys';
import { LIMIT_CHANNELS, limitKeyOfChannel, type ChannelLimitKind, type LimitChannel } from '../channelLimits';
import { identifierLimitOf } from './affiliateIdentifierLimit';

/**
 * Limites exibidos na tela "Assinatura" (`GET /subscription`, `.specs/features/subscription-page`).
 * Função pura: recebe o snapshot cru dos entitlements e o uso do tenant, devolve os itens do contrato.
 * Toda chave de `ENTITLEMENT_KEYS` é exibida aqui ou listada em `SUBSCRIPTION_HIDDEN_KEYS` (teste trava).
 */
export type SubscriptionLimitKind = 'count' | 'daily' | 'feature';

export interface SubscriptionLimitItemDef {
  key: EntitlementKey;
  channel: LimitChannel | null;
  kind: SubscriptionLimitKind;
}

/** Uso do tenant (preenchido por `ITenantUsageReader`). `null` = sem contador. */
export interface SubscriptionUsage {
  sessions: Record<LimitChannel, number>;
  monitoredGroups: Record<LimitChannel, number>;
  broadcastGroups: Record<LimitChannel, number>;
  linkRotations: Record<LimitChannel, number>;
  /** Ofertas geradas hoje (fuso de `startOfDayInZone`). */
  offerGenerationsToday: number;
  /** Pedidos de IA do dia; `null` se não houver contador. */
  aiRequestsToday: number | null;
  /** Etiquetas do Mercado Livre em uso: principal + vinculadas dentro do limite do plano (0 sem credencial). */
  mercadoLivreAffiliateTags: number;
}

export interface SubscriptionLimitItem extends SubscriptionLimitItemDef {
  /** feature = null; contador inexistente = null. */
  used: number | null;
  /** null = ilimitado (feature sempre null). */
  limit: number | null;
  /** feature: valor; count/daily: `limit !== 0`. */
  enabled: boolean;
}

/** Limites por canal com contagem agregada do tenant (`linkRotationGroups` é por rodízio, fica à parte). */
const COUNT_KINDS = ['sessions', 'monitoredGroups', 'broadcastGroups', 'linkRotations'] as const satisfies readonly ChannelLimitKind[];
type CountKind = (typeof COUNT_KINDS)[number];

/** Booleanos em que só `false` explícito bloqueia (ausente = liberado; `entitlementKeys.ts`). */
const FEATURES_DEFAULT_ON: ReadonlySet<EntitlementKey> = new Set([
  ENTITLEMENT_KEYS.MENTION_ALL_ENABLED,
  ENTITLEMENT_KEYS.AI_REWRITE_ENABLED,
]);

/** Chaves que não aparecem na tela. Chave nova entra na lista ou aqui, com motivo. Hoje nenhuma. */
export const SUBSCRIPTION_HIDDEN_KEYS: readonly EntitlementKey[] = [];

/** Chaves numéricas em que ausente não é "sem limite": o limite passa pela função do recurso. */
const LIMIT_OF: ReadonlyMap<EntitlementKey, (value: number | null) => number> = new Map([
  [ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS, identifierLimitOf],
  /** Achados do caçador: ausente = 0 (bloqueado), nunca ilimitado. */
  [ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY, (value) => value ?? 0],
]);

const channelItems = (kind: ChannelLimitKind): SubscriptionLimitItemDef[] =>
  LIMIT_CHANNELS.map((channel) => ({ key: limitKeyOfChannel(kind, channel), channel, kind: 'count' as const }));

const feature = (key: EntitlementKey): SubscriptionLimitItemDef => ({ key, channel: null, kind: 'feature' });

/** Ordem de exibição. */
export const SUBSCRIPTION_LIMIT_ITEMS: readonly SubscriptionLimitItemDef[] = [
  ...COUNT_KINDS.flatMap(channelItems),
  /** Grupos por rodízio: limite por rodízio, sem uso agregado (`used` null). */
  ...channelItems('linkRotationGroups'),
  { key: ENTITLEMENT_KEYS.OFFER_GENERATIONS_PER_DAY, channel: null, kind: 'daily' },
  { key: ENTITLEMENT_KEYS.AI_REQUESTS_PER_DAY, channel: null, kind: 'daily' },
  /** Etiquetas do ML: principal incluída; ausente vale 1 (`affiliateIdentifierLimit.ts`), nunca "sem limite". */
  { key: ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS, channel: null, kind: 'count' },
  /** Achados do caçador por dia: ausente = 0 (`LIMIT_OF`); sem contador de uso por ora (`used` null). */
  { key: ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY, channel: null, kind: 'daily' },
  feature(ENTITLEMENT_KEYS.AI_REWRITE_ENABLED),
  feature(ENTITLEMENT_KEYS.MENTION_ALL_ENABLED),
  feature(ENTITLEMENT_KEYS.CROSS_SESSION_DISPATCH),
  feature(ENTITLEMENT_KEYS.MARKETPLACE_EXTENSION),
  feature(ENTITLEMENT_KEYS.STOREFRONT_ENABLED),
  feature(ENTITLEMENT_KEYS.OFFER_STORY_ENABLED),
  feature(ENTITLEMENT_KEYS.ENRICH_LINK_ONLY_ENABLED),
  feature(ENTITLEMENT_KEYS.CAPTURE_OUTSIDE_WINDOW_ENABLED),
  feature(ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED),
  feature(ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED),
];

/** Mesma leitura do `PrismaEntitlementReader.getNumber`: número ou string numérica; resto = ausente. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Mesma leitura do `PrismaEntitlementReader.getBoolean`. */
function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return null;
}

const KEY_TO_COUNT: ReadonlyMap<EntitlementKey, { kind: CountKind; channel: LimitChannel }> = new Map(
  COUNT_KINDS.flatMap((kind) => LIMIT_CHANNELS.map((channel) => [limitKeyOfChannel(kind, channel), { kind, channel }] as const)),
);

function usedOf(def: SubscriptionLimitItemDef, usage: SubscriptionUsage): number | null {
  if (def.kind === 'feature') return null;
  if (def.key === ENTITLEMENT_KEYS.OFFER_GENERATIONS_PER_DAY) return usage.offerGenerationsToday;
  if (def.key === ENTITLEMENT_KEYS.AI_REQUESTS_PER_DAY) return usage.aiRequestsToday;
  if (def.key === ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS) return usage.mercadoLivreAffiliateTags;
  const c = KEY_TO_COUNT.get(def.key);
  return c ? usage[c.kind][c.channel] : null;
}

/** `values` = snapshot cru (`IEntitlementSnapshotReader.readAll`). Ausente numérico = ilimitado, salvo `LIMIT_OF`. */
export function buildSubscriptionLimits(values: Readonly<Record<string, unknown>>, usage: SubscriptionUsage): SubscriptionLimitItem[] {
  return SUBSCRIPTION_LIMIT_ITEMS.map((def) => {
    if (def.kind === 'feature') {
      const v = toBoolean(values[def.key]);
      return { ...def, used: null, limit: null, enabled: v ?? FEATURES_DEFAULT_ON.has(def.key) };
    }
    const raw = toNumber(values[def.key]);
    const limitOf = LIMIT_OF.get(def.key);
    const limit = limitOf ? limitOf(raw) : raw;
    return { ...def, used: usedOf(def, usage), limit, enabled: limit !== 0 };
  });
}
