import { apiClient } from './apiClient';
import type {
  AffiliateCredentialItem,
  AffiliateCredentialListResponse,
  AffiliateCredentialStatus,
  AffiliateProvider,
  ApiSuccess,
  UpsertAffiliateCredentialRequest,
} from '@/types/api.types';

const BASE = '/integrations/affiliate-credentials';

export const affiliateCredentialService = {
  async list(): Promise<AffiliateCredentialItem[]> {
    const res = await apiClient.get<ApiSuccess<AffiliateCredentialListResponse>>(BASE);
    return res.data.data.items;
  },

  async upsert(provider: AffiliateProvider, body: UpsertAffiliateCredentialRequest): Promise<AffiliateCredentialItem> {
    const res = await apiClient.put<ApiSuccess<AffiliateCredentialItem>>(`${BASE}/${provider}`, body);
    return res.data.data;
  },

  async remove(provider: AffiliateProvider): Promise<void> {
    await apiClient.delete(`${BASE}/${provider}`);
  },

  async setStatus(provider: AffiliateProvider, status: AffiliateCredentialStatus): Promise<AffiliateCredentialItem> {
    const res = await apiClient.patch<ApiSuccess<AffiliateCredentialItem>>(`${BASE}/${provider}/status`, { status });
    return res.data.data;
  },
};
