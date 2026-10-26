import { apiClient } from './apiClient';
import type {
  AiPlatformProvider,
  AiPlatformSettings,
  AiProviderTestResult,
  ApiSuccess,
  CreateAiPlatformProviderRequest,
  UpdateAiPlatformProviderRequest,
} from '@/types/api.types';

const BASE = '/admin/ai';

/** Configuração de IA da plataforma — rotas só de super admin. */
export const adminAiService = {
  async getSettings(): Promise<AiPlatformSettings> {
    const res = await apiClient.get<ApiSuccess<AiPlatformSettings>>(`${BASE}/settings`);
    return res.data.data;
  },

  async updateSettings(body: AiPlatformSettings): Promise<AiPlatformSettings> {
    const res = await apiClient.put<ApiSuccess<AiPlatformSettings>>(`${BASE}/settings`, body);
    return res.data.data;
  },

  async listProviders(): Promise<AiPlatformProvider[]> {
    const res = await apiClient.get<ApiSuccess<{ items: AiPlatformProvider[] }>>(`${BASE}/providers`);
    return res.data.data.items;
  },

  async createProvider(body: CreateAiPlatformProviderRequest): Promise<AiPlatformProvider> {
    const res = await apiClient.post<ApiSuccess<AiPlatformProvider>>(`${BASE}/providers`, body);
    return res.data.data;
  },

  async updateProvider(id: string, body: UpdateAiPlatformProviderRequest): Promise<AiPlatformProvider> {
    const res = await apiClient.patch<ApiSuccess<AiPlatformProvider>>(`${BASE}/providers/${id}`, body);
    return res.data.data;
  },

  async removeProvider(id: string): Promise<void> {
    await apiClient.delete(`${BASE}/providers/${id}`);
  },

  async testProvider(id: string): Promise<AiProviderTestResult> {
    const res = await apiClient.post<ApiSuccess<AiProviderTestResult>>(`${BASE}/providers/${id}/test`, {});
    return res.data.data;
  },
};
