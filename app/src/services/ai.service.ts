import { apiClient } from './apiClient';
import type {
  AiCatalogItem,
  AiProviderTestResult,
  ApiSuccess,
  TenantAiStatus,
  UpsertTenantAiCredentialRequest,
} from '@/types/api.types';

const BASE = '/ai';

/** IA do cliente (tenant): status do modo em uso e chave própria. */
export const aiService = {
  async getCatalog(): Promise<AiCatalogItem[]> {
    const res = await apiClient.get<ApiSuccess<{ items: AiCatalogItem[] }>>(`${BASE}/catalog`);
    return res.data.data.items;
  },

  async getStatus(): Promise<TenantAiStatus> {
    const res = await apiClient.get<ApiSuccess<TenantAiStatus>>(`${BASE}/status`);
    return res.data.data;
  },

  async saveCredential(body: UpsertTenantAiCredentialRequest): Promise<void> {
    await apiClient.put(`${BASE}/credential`, body);
  },

  async removeCredential(): Promise<void> {
    await apiClient.delete(`${BASE}/credential`);
  },

  async testCredential(): Promise<AiProviderTestResult> {
    const res = await apiClient.post<ApiSuccess<AiProviderTestResult>>(`${BASE}/credential/test`, {});
    return res.data.data;
  },
};
