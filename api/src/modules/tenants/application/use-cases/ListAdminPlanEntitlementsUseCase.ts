import { ADMIN_EDITABLE_ENTITLEMENT_KEYS, adminEntitlementProductOf, adminEntitlementTypeOf, type AdminEntitlementValueType } from '../../domain/adminEditableEntitlements';
import type { IPlanEntitlementPresetRepository } from '../../domain/contracts/IPlanEntitlementPresetRepository';
import { FEATURE_AUDIENCE_KEYS, isFeatureAudienceKey, type FeatureAudienceKey } from '../../domain/featureAudience';
import type { PlanPresetValue } from '../../domain/planPresets';
import { ALL_PLAN_SLUGS, isKnownPlanSlug, productOfPlanSlug, type AnyPlanSlug } from '../../domain/planCatalog';
import { isProductKey, type ProductKey } from '../../domain/services/resolveProductAccess';

/** Chave de audiência de produto (`saver` → `SAVER`); fora disso, Afiliados. */
function productOfAudienceKey(key: string): ProductKey {
  const upper = key.toUpperCase();
  return isProductKey(upper) ? upper : 'AFFILIATES';
}

export interface AdminPlanEntitlementRow {
  key: string;
  /** Tipo e faixa do valor (a tela escolhe Switch ou campo numérico). Ausente = linha só de audiência (sem preset). */
  type?: AdminEntitlementValueType;
  /** Valor do preset por plano; sem preset gravado = `null`. Linha só de audiência = `{}`. */
  plans: Partial<Record<AnyPlanSlug, PlanPresetValue>>;
  /** Produto dono da chave. */
  product: ProductKey;
  /** Planos em que a chave é editável (só os do produto dono); nos demais a tela não mostra controle. */
  editablePlans: AnyPlanSlug[];
  /** Audiência do recurso ("Só super admin"); `null` = a chave não tem audiência. */
  superAdminOnly: boolean | null;
}

/**
 * Super admin: chaves editáveis (allowlist) × planos de todos os produtos (`ALL_PLAN_SLUGS`), com o valor atual do
 * preset. Cada chave só é editável nos planos do produto dono (`editablePlans`).
 * Chaves de audiência fora da allowlist (ex.: `saver`, audiência de produto) entram no fim, só com a flag:
 * `plans` vazio, sem `type` e sem plano editável (a tela mostra "—" nas colunas de plano).
 */
export class ListAdminPlanEntitlementsUseCase {
  constructor(
    private readonly presets: IPlanEntitlementPresetRepository,
    private readonly audience: { all(): Promise<Record<FeatureAudienceKey, boolean>> },
  ) {}

  async execute(): Promise<AdminPlanEntitlementRow[]> {
    const [rows, audience] = await Promise.all([this.presets.listByKeys(ADMIN_EDITABLE_ENTITLEMENT_KEYS), this.audience.all()]);
    const editable: AdminPlanEntitlementRow[] = ADMIN_EDITABLE_ENTITLEMENT_KEYS.map((key) => {
      const plans = Object.fromEntries(ALL_PLAN_SLUGS.map((p) => [p, null])) as Record<AnyPlanSlug, PlanPresetValue>;
      for (const r of rows) {
        if (r.key === key && isKnownPlanSlug(r.planSlug)) plans[r.planSlug] = r.value;
      }
      const product = adminEntitlementProductOf(key);
      const editablePlans = ALL_PLAN_SLUGS.filter((p) => productOfPlanSlug(p) === product);
      return { key, type: adminEntitlementTypeOf(key), plans, product, editablePlans, superAdminOnly: isFeatureAudienceKey(key) ? audience[key] : null };
    });
    const editableKeys = new Set<string>(ADMIN_EDITABLE_ENTITLEMENT_KEYS);
    const audienceOnly = FEATURE_AUDIENCE_KEYS.filter((k) => !editableKeys.has(k)).map(
      (key): AdminPlanEntitlementRow => ({ key, plans: {}, product: productOfAudienceKey(key), editablePlans: [], superAdminOnly: audience[key] }),
    );
    return [...editable, ...audienceOnly];
  }
}
