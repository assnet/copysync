import { ENTITLEMENT_KEYS, type EntitlementKey } from '../entitlementKeys';
import { LIMIT_CHANNELS, limitKeyOfChannel, type ChannelLimitKind, type LimitChannel } from '../channelLimits';
import { identifierLimitOf } from './affiliateIdentifierLimit';
import { SHARED_KEYS } from '../sharedEntitlements';
import { isLegacyProduct, type ProductKey } from './resolveProductAccess';

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
  /** Produto dono da chave; `null` = recurso do tenant compartilhado entre produtos (sessões). */
  product: ProductKey | null;
}

/** Uso do tenant (preenchido por `ITenantUsageReader`). `null` = sem contador. */
export interface SubscriptionUsage {
  sessions: Record<LimitChannel, number>;
  monitoredGroups: Record<LimitChannel, number>;
  broadcastGroups: Record<LimitChannel, number>;
  linkRotations: Record<LimitChannel, number>;
  /** Ofertas geradas hoje (fuso de `startOfDayInZone`). */
  offerGenerationsToday: number;
  /** Achados do caçador hoje (mesmo `startOfDayInZone` do teto do caçador). */
  offerHunterFindsToday: number;
  /** Pedidos de IA do dia; `null` se não houver contador. */
  aiRequestsToday: number | null;
  /** Etiquetas do Mercado Livre em uso: principal + vinculadas dentro do limite do plano (0 sem credencial). */
  mercadoLivreAffiliateTags: number;
  /** Saver: grupos salvos não removidos (`ISaverGroupRepository.countActive`). */
  saverGroups: number;
  /** Saver: contatos distintos vinculados a grupo salvo não removido (`countDistinctContacts`). */
  saverContacts: number;
  /** Saver: leituras de grupo nas últimas 24 h corridas, sem as canceladas (`countScansSince`). */
  saverGroupScans: number;
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

/** Chaves que não aparecem na tela. Chave nova entra na lista ou aqui, com motivo. */
export const SUBSCRIPTION_HIDDEN_KEYS: readonly EntitlementKey[] = [];

/** Chaves numéricas de produto novo em que ausente vale 0 (só `null` explícito é ilimitado; presets do Saver). */
const ABSENT_IS_ZERO: ReadonlySet<EntitlementKey> = new Set([
  ENTITLEMENT_KEYS.SAVER_GROUPS,
  ENTITLEMENT_KEYS.SAVER_GROUP_SCANS_PER_DAY,
  ENTITLEMENT_KEYS.SAVER_CONTACTS,
]);

/** Chaves numéricas em que ausente não é "sem limite": o limite passa pela função do recurso. */
const LIMIT_OF: ReadonlyMap<EntitlementKey, (value: number | null) => number> = new Map([
  [ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS, identifierLimitOf],
  /** Achados do caçador: ausente = 0 (bloqueado), nunca ilimitado. */
  [ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY, (value) => value ?? 0],
]);

const SHARED: readonly string[] = SHARED_KEYS;

const channelItems = (kind: ChannelLimitKind): SubscriptionLimitItemDef[] =>
  LIMIT_CHANNELS.map((channel) => {
    const key = limitKeyOfChannel(kind, channel);
    return { key, channel, kind: 'count' as const, product: SHARED.includes(key) ? null : 'AFFILIATES' as const };
  });

const item = (key: EntitlementKey, kind: SubscriptionLimitKind, product: ProductKey = 'AFFILIATES'): SubscriptionLimitItemDef =>
  ({ key, channel: null, kind, product });
const feature = (key: EntitlementKey, product: ProductKey = 'AFFILIATES'): SubscriptionLimitItemDef => item(key, 'feature', product);

/** Ordem de exibição. */
export const SUBSCRIPTION_LIMIT_ITEMS: readonly SubscriptionLimitItemDef[] = [
  ...COUNT_KINDS.flatMap(channelItems),
  /** Grupos por rodízio: limite por rodízio, sem uso agregado (`used` null). */
  ...channelItems('linkRotationGroups'),
  item(ENTITLEMENT_KEYS.OFFER_GENERATIONS_PER_DAY, 'daily'),
  item(ENTITLEMENT_KEYS.AI_REQUESTS_PER_DAY, 'daily'),
  /** Etiquetas do ML: principal incluída; ausente vale 1 (`affiliateIdentifierLimit.ts`), nunca "sem limite". */
  item(ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS, 'count'),
  /** Achados do caçador por dia: ausente = 0 (`LIMIT_OF`); sem contador de uso por ora (`used` null). */
  item(ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY, 'daily'),
  feature(ENTITLEMENT_KEYS.AI_REWRITE_ENABLED),
  feature(ENTITLEMENT_KEYS.MENTION_ALL_ENABLED),
  feature(ENTITLEMENT_KEYS.CROSS_SESSION_DISPATCH),
  feature(ENTITLEMENT_KEYS.MARKETPLACE_EXTENSION),
  feature(ENTITLEMENT_KEYS.STOREFRONT_ENABLED),
  feature(ENTITLEMENT_KEYS.OFFER_STORY_ENABLED),
  feature(ENTITLEMENT_KEYS.ENRICH_LINK_ONLY_ENABLED),
  feature(ENTITLEMENT_KEYS.CAPTURE_OUTSIDE_WINDOW_ENABLED),
  feature(ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED),
  feature(ENTITLEMENT_KEYS.MARKETPLACE_KABUM_ENABLED),
  feature(ENTITLEMENT_KEYS.MARKETPLACE_MAGALU_ENABLED),
  feature(ENTITLEMENT_KEYS.MARKETPLACE_ALIEXPRESS_ENABLED),
  feature(ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED),
  /** Saver: ausente = 0/desligado (`ABSENT_IS_ZERO`); uso com as regras do Saver (`GetSaverOverviewUseCase`). */
  item(ENTITLEMENT_KEYS.SAVER_GROUPS, 'count', 'SAVER'),
  item(ENTITLEMENT_KEYS.SAVER_CONTACTS, 'count', 'SAVER'),
  item(ENTITLEMENT_KEYS.SAVER_GROUP_SCANS_PER_DAY, 'daily', 'SAVER'),
  feature(ENTITLEMENT_KEYS.SAVER_AUTO_REFRESH_ENABLED, 'SAVER'),
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
  if (def.key === ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY) return usage.offerHunterFindsToday;
  if (def.key === ENTITLEMENT_KEYS.AI_REQUESTS_PER_DAY) return usage.aiRequestsToday;
  if (def.key === ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS) return usage.mercadoLivreAffiliateTags;
  if (def.key === ENTITLEMENT_KEYS.SAVER_GROUPS) return usage.saverGroups;
  if (def.key === ENTITLEMENT_KEYS.SAVER_CONTACTS) return usage.saverContacts;
  if (def.key === ENTITLEMENT_KEYS.SAVER_GROUP_SCANS_PER_DAY) return usage.saverGroupScans;
  const c = KEY_TO_COUNT.get(def.key);
  return c ? usage[c.kind][c.channel] : null;
}

/**
 * `values` = snapshot cru (`IEntitlementSnapshotReader.readAll`). Ausente numérico = ilimitado, salvo `LIMIT_OF`
 * e `ABSENT_IS_ZERO`. Itens de produto novo só entram se o produto estiver em `products` (padrão: nenhum),
 * então o tenant legado recebe exatamente os itens de antes.
 */
export function buildSubscriptionLimits(
  values: Readonly<Record<string, unknown>>,
  usage: SubscriptionUsage,
  products: readonly ProductKey[] = [],
): SubscriptionLimitItem[] {
  const visible = SUBSCRIPTION_LIMIT_ITEMS.filter((d) => d.product === null || isLegacyProduct(d.product) || products.includes(d.product));
  return visible.map((def) => {
    if (def.kind === 'feature') {
      const v = toBoolean(values[def.key]);
      return { ...def, used: null, limit: null, enabled: v ?? FEATURES_DEFAULT_ON.has(def.key) };
    }
    const absent = !Object.prototype.hasOwnProperty.call(values, def.key) || values[def.key] === undefined;
    const raw = absent && ABSENT_IS_ZERO.has(def.key) ? 0 : toNumber(values[def.key]);
    const limitOf = LIMIT_OF.get(def.key);
    const limit = limitOf ? limitOf(raw) : raw;
    return { ...def, used: usedOf(def, usage), limit, enabled: limit !== 0 };
  });
}
