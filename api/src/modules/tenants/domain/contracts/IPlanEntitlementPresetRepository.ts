import type { PlanPresetValue } from '../planPresets';
import type { AnyPlanSlug } from '../planCatalog';

export interface PlanEntitlementPresetRow {
  planSlug: string;
  key: string;
  /** JSON da coluna já como valor de domínio; JSON que não é boolean/number vira `null`. */
  value: PlanPresetValue;
}

export interface SetPlanEntitlementInput {
  /** Afiliados ou produto novo (`ALL_PLAN_SLUGS`). */
  planSlug: AnyPlanSlug;
  key: string;
  value: PlanPresetValue;
}

/** Presets de entitlement por plano (`plan_entitlement_presets`). */
export interface IPlanEntitlementPresetRepository {
  listByKeys(keys: readonly string[]): Promise<PlanEntitlementPresetRow[]>;
  /**
   * Grava o preset e propaga o valor para `tenant_entitlements` na mesma transação: plano de Afiliados =
   * tenants com esse `Tenant.planSlug`; produto novo = linha ativa de `tenant_products` com o plano (chave
   * compartilhada só pelo merge). Devolve quantos tenants foram alcançados.
   */
  setForPlan(input: SetPlanEntitlementInput): Promise<{ tenantsUpdated: number }>;
}
