import { ADMIN_EDITABLE_ENTITLEMENT_KEYS, adminEntitlementTypeOf, type AdminEntitlementValueType } from '../../domain/adminEditableEntitlements';
import type { IPlanEntitlementPresetRepository } from '../../domain/contracts/IPlanEntitlementPresetRepository';
import { PLAN_SLUGS, type PlanPresetValue, type PlanSlug } from '../../domain/planPresets';

export interface AdminPlanEntitlementRow {
  key: string;
  /** Tipo e faixa do valor (a tela escolhe Switch ou campo numérico). */
  type: AdminEntitlementValueType;
  /** Valor do preset por plano; sem preset gravado = `null`. */
  plans: Record<PlanSlug, PlanPresetValue>;
}

/** Super admin: chaves editáveis (allowlist) × planos, com o valor atual do preset. */
export class ListAdminPlanEntitlementsUseCase {
  constructor(private readonly presets: IPlanEntitlementPresetRepository) {}

  async execute(): Promise<AdminPlanEntitlementRow[]> {
    const rows = await this.presets.listByKeys(ADMIN_EDITABLE_ENTITLEMENT_KEYS);
    return ADMIN_EDITABLE_ENTITLEMENT_KEYS.map((key) => {
      const plans = Object.fromEntries(PLAN_SLUGS.map((p) => [p, null])) as Record<PlanSlug, PlanPresetValue>;
      for (const r of rows) {
        if (r.key === key && (PLAN_SLUGS as readonly string[]).includes(r.planSlug)) plans[r.planSlug as PlanSlug] = r.value;
      }
      return { key, type: adminEntitlementTypeOf(key), plans };
    });
  }
}
