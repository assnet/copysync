import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type { AdminPlanEntitlementList, SetPlanEntitlementResult } from '@/features/planEntitlementsAdmin/types';

const BASE = '/admin/plan-entitlements';

/** Recursos editáveis por plano — rotas só de super admin. Alterar propaga para os tenants do plano. */
export const adminPlanEntitlementsService = {
  async list(): Promise<AdminPlanEntitlementList> {
    const res = await apiClient.get<ApiSuccess<AdminPlanEntitlementList>>(BASE);
    return res.data.data;
  },

  async set(planSlug: string, key: string, value: boolean): Promise<SetPlanEntitlementResult> {
    const res = await apiClient.put<ApiSuccess<SetPlanEntitlementResult>>(
      `${BASE}/${encodeURIComponent(planSlug)}/${encodeURIComponent(key)}`,
      { value },
    );
    return res.data.data;
  },
};
