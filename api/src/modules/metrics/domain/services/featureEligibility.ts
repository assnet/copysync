import { ENTITLEMENT_KEYS, type EntitlementKey } from '../../../tenants/domain/entitlementKeys';
import { presetOf } from '../../../tenants/domain/planPresets';
import {
  type ProductKey,
  type TenantProductStatus,
  accessSourceOf,
  resolveProductAccess,
} from '../../../tenants/domain/services/resolveProductAccess';
import type { FeatureUsageDefinition, FeatureUsagePlanFamily, FeatureUsageProduct } from './featureUsageCatalog';

/**
 * Direito ao recurso hoje (P3, denominador da adoção; spec "Medidas"). Puro: recebe o retrato de cada conta e
 * decide por recurso. Produto pela regra de `tenants` (`accessSourceOf` + `resolveProductAccess`, nunca
 * reescrita); entitlement por `FEATURE_ENTITLEMENT_KEYS`, com o preset do plano quando a conta não tem a chave.
 */

/** Linha de `tenant_products` de um produto fonte. */
export interface EligibilityProductRow {
  status: TenantProductStatus;
  planSlug: string | null;
}

/** Retrato de uma conta para o direito ao recurso. Sem nome. */
export interface EligibilitySnapshot {
  tenantId: string;
  /** `Tenant.planSlug` cru (plano de Afiliados). */
  planSlug: string | null;
  /** Linhas de `tenant_products` por produto (só as que existem). */
  products: Readonly<Record<string, EligibilityProductRow>>;
  /** Valores crus das chaves de entitlement pedidas (só as que a conta tem). */
  entitlements: Readonly<Record<string, unknown>>;
}

/** Como cada chave de entitlement libera (a mesma leitura dos use cases do recurso). */
type EntitlementRule = 'TRUE_ONLY' | 'NOT_FALSE' | 'POSITIVE_OR_UNLIMITED';

const ENTITLEMENT_RULES: Readonly<Record<string, EntitlementRule>> = {
  // Vitrine, Story e Caçador: só `true` libera (`getBoolean(...) === true` nos use cases)
  [ENTITLEMENT_KEYS.STOREFRONT_ENABLED]: 'TRUE_ONLY',
  [ENTITLEMENT_KEYS.OFFER_STORY_ENABLED]: 'TRUE_ONLY',
  [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]: 'TRUE_ONLY',
  // Reescrita por IA: só `false` explícito bloqueia
  [ENTITLEMENT_KEYS.AI_REWRITE_ENABLED]: 'NOT_FALSE',
  // Sessões: ausente/`null` = ilimitado; número > 0 libera
  [ENTITLEMENT_KEYS.TELEGRAM_SESSIONS]: 'POSITIVE_OR_UNLIMITED',
};

/**
 * Recurso → entitlement que o libera. Fica aqui, e não no catálogo, para o catálogo seguir só com a fonte da
 * medida. Recurso fora do mapa: basta o produto ativo.
 */
export const FEATURE_ENTITLEMENT_KEYS: Readonly<Record<string, EntitlementKey>> = {
  storefront: ENTITLEMENT_KEYS.STOREFRONT_ENABLED,
  offer_story: ENTITLEMENT_KEYS.OFFER_STORY_ENABLED,
  offer_hunter: ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED,
  ai_rewrite: ENTITLEMENT_KEYS.AI_REWRITE_ENABLED,
  telegram_session: ENTITLEMENT_KEYS.TELEGRAM_SESSIONS,
};

/** Produto do catálogo → produto de acesso; `SESSION`/`ACCESS` são da conta, sem produto. */
const ACCESS_PRODUCT: Readonly<Partial<Record<FeatureUsageProduct, ProductKey>>> = {
  AFFILIATES: 'AFFILIATES',
  CHAT: 'CHAT',
  SAVER: 'SAVER',
};

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Valor da regra; `undefined` = chave ausente na conta e no preset. */
export function entitlementAllows(key: string, value: unknown): boolean {
  switch (ENTITLEMENT_RULES[key] ?? 'TRUE_ONLY') {
    case 'TRUE_ONLY':
      return toBoolean(value) === true;
    case 'NOT_FALSE':
      return toBoolean(value) !== false;
    case 'POSITIVE_OR_UNLIMITED': {
      if (value === undefined || value === null) return true;
      const n = toNumber(value);
      return n === null || n > 0;
    }
  }
}

/** Chaves de entitlement que a leitura precisa buscar para estes recursos. */
export function entitlementKeysOf(features: readonly FeatureUsageDefinition[]): string[] {
  return [...new Set(features.map((f) => FEATURE_ENTITLEMENT_KEYS[f.key]).filter((k): k is NonNullable<typeof k> => !!k))].sort();
}

function planOf(snapshot: EligibilitySnapshot, family: FeatureUsagePlanFamily): string | null {
  return family === 'SAVER' ? (snapshot.products.SAVER?.planSlug ?? null) : snapshot.planSlug;
}

/** Produto ativo hoje pela linha do produto **fonte** (`CHAT` segue `AFFILIATES`). */
export function hasProductAccess(snapshot: EligibilitySnapshot, product: FeatureUsageProduct): boolean {
  const key = ACCESS_PRODUCT[product];
  if (!key) return true;
  const row = snapshot.products[accessSourceOf(key)];
  return resolveProductAccess(key, row ? { status: row.status } : null);
}

/** Direito da conta ao recurso: produto ativo e, se houver, entitlement (conta, senão preset do plano). */
export function isEligible(snapshot: EligibilitySnapshot, feature: FeatureUsageDefinition): boolean {
  if (!hasProductAccess(snapshot, feature.product)) return false;
  const key = FEATURE_ENTITLEMENT_KEYS[feature.key];
  if (!key) return true;
  if (Object.prototype.hasOwnProperty.call(snapshot.entitlements, key)) return entitlementAllows(key, snapshot.entitlements[key]);
  const plan = planOf(snapshot, feature.planFamily);
  const preset = plan ? presetOf(plan) : undefined;
  const fromPreset = preset && Object.prototype.hasOwnProperty.call(preset, key) ? preset[key] : undefined;
  return entitlementAllows(key, fromPreset);
}

/** Por recurso, as contas com direito hoje. */
export function eligibleTenantsByFeature(
  snapshots: readonly EligibilitySnapshot[],
  features: readonly FeatureUsageDefinition[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>(features.map((f) => [f.key, new Set<string>()]));
  for (const snapshot of snapshots) {
    for (const feature of features) if (isEligible(snapshot, feature)) out.get(feature.key)!.add(snapshot.tenantId);
  }
  return out;
}
