/** Slugs de plano da API (fonte: `api/src/modules/tenants/domain/planPresets.ts`). */
export type AdminPlanSlug = 'COPYSYNC_LITE' | 'COPYSYNC_PRO' | 'COPYSYNC_MAX';

/** Valor do preset; `null` = plano sem preset gravado (trata como desligado). */
export type PlanEntitlementValue = boolean | number | null;

export interface AdminPlanEntitlementRow {
  key: string;
  plans: Partial<Record<string, PlanEntitlementValue>>;
}

export interface AdminPlanEntitlementList {
  plans: string[];
  entitlements: AdminPlanEntitlementRow[];
}

export interface SetPlanEntitlementResult {
  planSlug: string;
  key: string;
  value: boolean;
  tenantsUpdated: number;
}
