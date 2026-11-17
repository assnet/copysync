import { ADMIN_EDITABLE_ENTITLEMENT_KEYS, adminEntitlementTypeOf, type AdminEntitlementValueType } from '../../domain/adminEditableEntitlements';
import type { IPlanEntitlementPresetRepository } from '../../domain/contracts/IPlanEntitlementPresetRepository';
import { FEATURE_AUDIENCE_KEYS, isFeatureAudienceKey, type FeatureAudienceKey } from '../../domain/featureAudience';
import type { PlanPresetValue } from '../../domain/planPresets';
import { ALL_PLAN_SLUGS, isKnownPlanSlug, type AnyPlanSlug } from '../../domain/planCatalog';

export interface AdminPlanEntitlementRow {
  key: string;
  /** Tipo e faixa do valor (a tela escolhe Switch ou campo numérico). Ausente = linha só de audiência (sem preset). */
  type?: AdminEntitlementValueType;
  /** Valor do preset por plano; sem preset gravado = `null`. Linha só de audiência = `{}`. */
  plans: Partial<Record<AnyPlanSlug, PlanPresetValue>>;
  /** Audiência do recurso ("Só super admin"); `null` = a chave não tem audiência. */
  superAdminOnly: boolean | null;
}

/**
 * Super admin: chaves editáveis (allowlist) × planos de todos os produtos (`ALL_PLAN_SLUGS`), com o valor atual do preset.
 * Chaves de audiência fora da allowlist (ex.: `saver`, audiência de produto) entram no fim, só com a flag:
 * `plans` vazio e sem `type` (a tela mostra "—" nas colunas de plano).
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
      return { key, type: adminEntitlementTypeOf(key), plans, superAdminOnly: isFeatureAudienceKey(key) ? audience[key] : null };
    });
    const editableKeys = new Set<string>(ADMIN_EDITABLE_ENTITLEMENT_KEYS);
    const audienceOnly = FEATURE_AUDIENCE_KEYS.filter((k) => !editableKeys.has(k)).map(
      (key): AdminPlanEntitlementRow => ({ key, plans: {}, superAdminOnly: audience[key] }),
    );
    return [...editable, ...audienceOnly];
  }
}
