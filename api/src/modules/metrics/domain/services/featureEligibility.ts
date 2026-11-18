import { ENTITLEMENT_KEYS, type EntitlementKey } from '../../../tenants/domain/entitlementKeys';
import { type FeatureAudienceKey, SAVER_AUDIENCE_KEY } from '../../../tenants/domain/featureAudience';
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
  /** Conta interna: algum membro super admin (mesma regra do diretório de contas). Ausente = não. */
  internal?: boolean;
}

/**
 * Audiência efetiva de cada chave (flag "Só super admin" de `/admin/plan-entitlements`, `platform_settings
 * ["feature_audience"]`, senão o valor inicial da env): `true` = só super admin. Ausente = todo tenant.
 */
export type EligibilityAudience = Readonly<Partial<Record<FeatureAudienceKey, boolean>>>;

/** Como cada chave de entitlement libera (a mesma leitura dos use cases do recurso). */
type EntitlementRule = 'TRUE_ONLY' | 'NOT_FALSE' | 'POSITIVE_OR_UNLIMITED' | 'POSITIVE';

const ENTITLEMENT_RULES: Readonly<Record<string, EntitlementRule>> = {
  // Vitrine, Story e Caçador: só `true` libera (`getBoolean(...) === true` nos use cases)
  [ENTITLEMENT_KEYS.STOREFRONT_ENABLED]: 'TRUE_ONLY',
  [ENTITLEMENT_KEYS.OFFER_STORY_ENABLED]: 'TRUE_ONLY',
  [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]: 'TRUE_ONLY',
  // Reescrita por IA: só `false` explícito bloqueia
  [ENTITLEMENT_KEYS.AI_REWRITE_ENABLED]: 'NOT_FALSE',
  // Sessões: ausente/`null` = ilimitado; número > 0 libera
  [ENTITLEMENT_KEYS.TELEGRAM_SESSIONS]: 'POSITIVE_OR_UNLIMITED',
  // Teto diário do Caçador: ausente/`null` = 0 (o job não roda sem teto); só número > 0 libera
  [ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY]: 'POSITIVE',
};

/**
 * Recurso → entitlements que o liberam (todos precisam liberar). Fica aqui, e não no catálogo, para o catálogo seguir
 * só com a fonte da medida. Recurso fora do mapa: basta o produto ativo.
 */
export const FEATURE_ENTITLEMENT_KEYS: Readonly<Record<string, readonly EntitlementKey[]>> = {
  storefront: [ENTITLEMENT_KEYS.STOREFRONT_ENABLED],
  offer_story: [ENTITLEMENT_KEYS.OFFER_STORY_ENABLED],
  // Caçador: flag e teto diário > 0 (ausente = 0), como o portão do recurso
  offer_hunter: [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED, ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY],
  ai_rewrite: [ENTITLEMENT_KEYS.AI_REWRITE_ENABLED],
  telegram_session: [ENTITLEMENT_KEYS.TELEGRAM_SESSIONS],
};

/**
 * Recurso → chave de audiência (`featureAudience.ts`). Com a audiência "Só super admin", só conta interna tem
 * direito: conta comum não vê o recurso, então não entra no denominador da adoção.
 */
export const FEATURE_AUDIENCE_OF: Readonly<Record<string, FeatureAudienceKey>> = {
  offer_hunter: ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED,
  saver_extraction: SAVER_AUDIENCE_KEY,
  saver_export: SAVER_AUDIENCE_KEY,
};

/**
 * Recursos só de conta interna enquanto o menu deles for só de super admin. `chat_send`: o item "Chat" do menu é
 * `superAdminOnly` em `app/src/features/navigation/model.ts`; ao abrir o menu a todos, tirar a chave daqui.
 */
export const INTERNAL_ONLY_FEATURES: ReadonlySet<string> = new Set(['chat_send']);

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
    case 'POSITIVE': {
      const n = toNumber(value);
      return n !== null && n > 0;
    }
  }
}

/** Chaves de entitlement que a leitura precisa buscar para estes recursos. */
export function entitlementKeysOf(features: readonly FeatureUsageDefinition[]): string[] {
  return [...new Set(features.flatMap((f) => FEATURE_ENTITLEMENT_KEYS[f.key] ?? []))].sort();
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

/** Valor da chave na conta, senão no preset do plano da família do recurso. */
function entitlementOf(snapshot: EligibilitySnapshot, feature: FeatureUsageDefinition, key: string): boolean {
  if (Object.prototype.hasOwnProperty.call(snapshot.entitlements, key)) return entitlementAllows(key, snapshot.entitlements[key]);
  const plan = planOf(snapshot, feature.planFamily);
  const preset = plan ? presetOf(plan) : undefined;
  const fromPreset = preset && Object.prototype.hasOwnProperty.call(preset, key) ? (preset as Record<string, unknown>)[key] : undefined;
  return entitlementAllows(key, fromPreset);
}

/**
 * Direito da conta ao recurso: só conta interna nos recursos internos e nos de audiência "Só super admin"; produto
 * ativo; e, se houver, cada entitlement (conta, senão preset do plano).
 */
export function isEligible(snapshot: EligibilitySnapshot, feature: FeatureUsageDefinition, audience: EligibilityAudience = {}): boolean {
  const internal = snapshot.internal === true;
  if (INTERNAL_ONLY_FEATURES.has(feature.key) && !internal) return false;
  const audienceKey = FEATURE_AUDIENCE_OF[feature.key];
  if (audienceKey && audience[audienceKey] === true && !internal) return false;
  if (!hasProductAccess(snapshot, feature.product)) return false;
  return (FEATURE_ENTITLEMENT_KEYS[feature.key] ?? []).every((key) => entitlementOf(snapshot, feature, key));
}

/** Por recurso, as contas com direito hoje. */
export function eligibleTenantsByFeature(
  snapshots: readonly EligibilitySnapshot[],
  features: readonly FeatureUsageDefinition[],
  audience: EligibilityAudience = {},
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>(features.map((f) => [f.key, new Set<string>()]));
  for (const snapshot of snapshots) {
    for (const feature of features) if (isEligible(snapshot, feature, audience)) out.get(feature.key)!.add(snapshot.tenantId);
  }
  return out;
}
