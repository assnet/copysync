import { apiClient } from './apiClient';
import type { MeResponse, TenantItem, SwitchTenantResponse } from '@/types/api.types';

export const tenantService = {
  async getMe(): Promise<MeResponse> {
    const res = await apiClient.get<{ success: true; data: MeResponse }>('/me');
    return res.data.data;
  },

  async listTenants(): Promise<TenantItem[]> {
    const res = await apiClient.get<TenantItem[]>('/tenants');
    return res.data;
  },

  async switchTenant(tenantId: string): Promise<SwitchTenantResponse> {
    const res = await apiClient.post<SwitchTenantResponse>('/tenants/switch', { tenantId });
    return res.data;
  },
};
