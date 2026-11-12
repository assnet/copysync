/** Slugs de plano da API (fonte: `api/src/modules/tenants/domain/planPresets.ts`). */
export type AdminPlanSlug = 'COPYSYNC_LITE' | 'COPYSYNC_PRO' | 'COPYSYNC_MAX';

/** Valor do preset; `null` = plano sem preset gravado (trata como desligado). */
export type PlanEntitlementValue = boolean | number | null;

/** Tipo do valor da chave (fonte: `api/src/modules/tenants/domain/adminEditableEntitlements.ts`). */
export type AdminEntitlementValueType =
  | { kind: 'boolean' }
  | { kind: 'integer'; min: number; max: number };

/** Valor que a tela grava: boolean (Switch) ou inteiro na faixa (campo numérico). */
export type EditablePlanEntitlementValue = boolean | number;

export interface AdminPlanEntitlementRow {
  key: string;
  type: AdminEntitlementValueType;
  plans: Partial<Record<string, PlanEntitlementValue>>;
}

export interface AdminPlanEntitlementList {
  plans: string[];
  entitlements: AdminPlanEntitlementRow[];
}

export interface SetPlanEntitlementResult {
  planSlug: string;
  key: string;
  value: EditablePlanEntitlementValue;
  tenantsUpdated: number;
}
