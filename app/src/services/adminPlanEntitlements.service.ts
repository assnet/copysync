import { apiClient } from './apiClient';
import type { ApiSuccess } from '@/types/api.types';
import type {
  AdminPlanEntitlementList, EditablePlanEntitlementValue, SetEntitlementAudienceResult, SetPlanEntitlementResult,
} from '@/features/planEntitlementsAdmin/types';

const BASE = '/admin/plan-entitlements';

/** Recursos editáveis por plano — rotas só de super admin. Alterar propaga para os tenants do plano. */
export const adminPlanEntitlementsService = {
  async list(): Promise<AdminPlanEntitlementList> {
    const res = await apiClient.get<ApiSuccess<AdminPlanEntitlementList>>(BASE);
    return res.data.data;
  },

  async set(planSlug: string, key: string, value: EditablePlanEntitlementValue): Promise<SetPlanEntitlementResult> {
    const res = await apiClient.put<ApiSuccess<SetPlanEntitlementResult>>(
      `${BASE}/${encodeURIComponent(planSlug)}/${encodeURIComponent(key)}`,
      { value },
    );
    return res.data.data;
  },

  /** Só para chaves com audiência (`superAdminOnly !== null`); demais → 400. Vale na hora (sem novo login). */
  async setAudience(key: string, superAdminOnly: boolean): Promise<SetEntitlementAudienceResult> {
    const res = await apiClient.put<ApiSuccess<Partial<SetEntitlementAudienceResult> | null>>(
      `${BASE}/${encodeURIComponent(key)}/audience`,
      { superAdminOnly },
    );
    const out = res.data?.data;
    // Resposta sem o valor: vale o que foi pedido (a API só responde 200 depois de gravar)
    return { key, superAdminOnly: typeof out?.superAdminOnly === 'boolean' ? out.superAdminOnly : superAdminOnly };
  },
};
