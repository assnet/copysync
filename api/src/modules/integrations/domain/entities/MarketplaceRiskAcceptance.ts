import type { AffiliateProvider } from '../enums/AffiliateProvider';
import type { MarketplaceRiskScope } from '../enums/MarketplaceRiskScope';

/** Aceite do aviso de risco de um marketplace, por tenant, escopo e versão. Imutável depois de gravado. */
export interface MarketplaceRiskAcceptance {
  id: string;
  tenantId: string;
  provider: AffiliateProvider;
  scope: MarketplaceRiskScope;
  noticeVersion: string;
  acceptedByUserId: string;
  locale: string;
  acceptedAt: Date;
}
