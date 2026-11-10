import { apiClient } from './apiClient';
import type {
  AcceptMarketplaceRiskRequest,
  AcceptMarketplaceRiskResponse,
  AffiliateCredentialItem,
  AffiliateCredentialListResponse,
  AffiliateCredentialStatus,
  AffiliateProvider,
  ApiSuccess,
  MarketplaceAvailability,
  UpsertAffiliateCredentialRequest,
} from '@/types/api.types';

const BASE = '/integrations/affiliate-credentials';

export interface AffiliateCredentialList {
  items: AffiliateCredentialItem[];
  marketplaceAvailability: Partial<Record<AffiliateProvider, MarketplaceAvailability>>;
}

export const affiliateCredentialService = {
  async list(): Promise<AffiliateCredentialList> {
    const res = await apiClient.get<ApiSuccess<AffiliateCredentialListResponse>>(BASE);
    const data = res.data.data;
    return { items: data.items, marketplaceAvailability: data.marketplaceAvailability ?? {} };
  },

  async upsert(provider: AffiliateProvider, body: UpsertAffiliateCredentialRequest): Promise<AffiliateCredentialItem> {
    const res = await apiClient.put<ApiSuccess<AffiliateCredentialItem>>(`${BASE}/${provider}`, body);
    return res.data.data;
  },

  /** Não serve para provider com `identifierFromSession` (Shein): a API devolve 409; use a rota da extensão. */
  async remove(provider: AffiliateProvider): Promise<void> {
    await apiClient.delete(`${BASE}/${provider}`);
  },

  async setStatus(provider: AffiliateProvider, status: AffiliateCredentialStatus): Promise<AffiliateCredentialItem> {
    const res = await apiClient.patch<ApiSuccess<AffiliateCredentialItem>>(`${BASE}/${provider}/status`, { status });
    return res.data.data;
  },

  /** Aceite do aviso de risco vigente (só admin do tenant). 409 `MARKETPLACE_RISK_NOTICE_OUTDATED` = texto mudou. */
  async acceptRisk(provider: AffiliateProvider, body: AcceptMarketplaceRiskRequest): Promise<AcceptMarketplaceRiskResponse> {
    const res = await apiClient.post<ApiSuccess<AcceptMarketplaceRiskResponse>>(`${BASE}/${provider}/risk-acceptance`, body);
    return res.data.data;
  },
};
