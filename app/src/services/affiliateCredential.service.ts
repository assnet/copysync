import { apiClient } from './apiClient';
import type {
  AcceptMarketplaceRiskRequest,
  AcceptMarketplaceRiskResponse,
  AffiliateCredentialItem,
  AffiliateCredentialListResponse,
  AffiliateCredentialStatus,
  AffiliateIdentifiers,
  AffiliateProvider,
  ApiSuccess,
  MarketplaceAvailability,
  SetAffiliateIdentifiersRequest,
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

  /** Etiquetas da conta, principal e vinculadas (só provider com sessão, hoje ML). */
  async getIdentifiers(provider: AffiliateProvider): Promise<AffiliateIdentifiers> {
    const res = await apiClient.get<ApiSuccess<AffiliateIdentifiers>>(`${BASE}/${provider}/identifiers`);
    return res.data.data;
  },

  /** 403 `PLAN_LIMIT_REACHED` acima do limite; 422 `AFFILIATE_CREDENTIAL_INVALID` fora da conta. */
  async setIdentifiers(provider: AffiliateProvider, body: SetAffiliateIdentifiersRequest): Promise<AffiliateIdentifiers> {
    const res = await apiClient.put<ApiSuccess<AffiliateIdentifiers>>(`${BASE}/${provider}/identifiers`, body);
    return res.data.data;
  },

  /**
   * Aceite do aviso de risco vigente (só admin do tenant). 409 `MARKETPLACE_RISK_NOTICE_OUTDATED` = texto mudou.
   * `scope: 'OFFER_HUNTER'` aceita o aviso do caçador (versão própria); sem `scope`, o aviso do link de afiliado.
   */
  async acceptRisk(provider: AffiliateProvider, body: AcceptMarketplaceRiskRequest): Promise<AcceptMarketplaceRiskResponse> {
    const res = await apiClient.post<ApiSuccess<AcceptMarketplaceRiskResponse>>(`${BASE}/${provider}/risk-acceptance`, body);
    return res.data.data;
  },
};
