import type { PlanPresetValue, PlanSlug } from '../planPresets';

export interface PlanEntitlementPresetRow {
  planSlug: string;
  key: string;
  /** JSON da coluna já como valor de domínio; JSON que não é boolean/number vira `null`. */
  value: PlanPresetValue;
}

export interface SetPlanEntitlementInput {
  planSlug: PlanSlug;
  key: string;
  value: PlanPresetValue;
}

/** Presets de entitlement por plano (`plan_entitlement_presets`). */
export interface IPlanEntitlementPresetRepository {
  listByKeys(keys: readonly string[]): Promise<PlanEntitlementPresetRow[]>;
  /**
   * Grava o preset e propaga o valor para `tenant_entitlements` de todos os tenants com esse `planSlug`,
   * na mesma transação. Devolve quantos tenants receberam o valor.
   */
  setForPlan(input: SetPlanEntitlementInput): Promise<{ tenantsUpdated: number }>;
}
