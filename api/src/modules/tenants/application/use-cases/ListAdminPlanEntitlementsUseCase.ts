import { ADMIN_EDITABLE_ENTITLEMENT_KEYS, adminEntitlementTypeOf, type AdminEntitlementValueType } from '../../domain/adminEditableEntitlements';
import type { IPlanEntitlementPresetRepository } from '../../domain/contracts/IPlanEntitlementPresetRepository';
import { isFeatureAudienceKey, type FeatureAudienceKey } from '../../domain/featureAudience';
import { PLAN_SLUGS, type PlanPresetValue, type PlanSlug } from '../../domain/planPresets';

export interface AdminPlanEntitlementRow {
  key: string;
  /** Tipo e faixa do valor (a tela escolhe Switch ou campo numérico). */
  type: AdminEntitlementValueType;
  /** Valor do preset por plano; sem preset gravado = `null`. */
  plans: Record<PlanSlug, PlanPresetValue>;
  /** Audiência do recurso ("Só super admin"); `null` = a chave não tem audiência. */
  superAdminOnly: boolean | null;
}

/** Super admin: chaves editáveis (allowlist) × planos, com o valor atual do preset. */
export class ListAdminPlanEntitlementsUseCase {
  constructor(
    private readonly presets: IPlanEntitlementPresetRepository,
    private readonly audience: { all(): Promise<Record<FeatureAudienceKey, boolean>> },
  ) {}

  async execute(): Promise<AdminPlanEntitlementRow[]> {
    const [rows, audience] = await Promise.all([this.presets.listByKeys(ADMIN_EDITABLE_ENTITLEMENT_KEYS), this.audience.all()]);
    return ADMIN_EDITABLE_ENTITLEMENT_KEYS.map((key) => {
      const plans = Object.fromEntries(PLAN_SLUGS.map((p) => [p, null])) as Record<PlanSlug, PlanPresetValue>;
      for (const r of rows) {
        if (r.key === key && (PLAN_SLUGS as readonly string[]).includes(r.planSlug)) plans[r.planSlug as PlanSlug] = r.value;
      }
      return { key, type: adminEntitlementTypeOf(key), plans, superAdminOnly: isFeatureAudienceKey(key) ? audience[key] : null };
    });
  }
}
