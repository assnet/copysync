import type { AffiliateProvider } from '../enums/AffiliateProvider';

/** Aceite do aviso de risco de um marketplace, por tenant e versão. Imutável depois de gravado. */
export interface MarketplaceRiskAcceptance {
  id: string;
  tenantId: string;
  provider: AffiliateProvider;
  noticeVersion: string;
  acceptedByUserId: string;
  locale: string;
  acceptedAt: Date;
}
