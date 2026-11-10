import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';

export interface IExtensionEntitlementReader {
  hasMarketplaceExtension(tenantId: string): Promise<boolean>;
  /** Plano libera o marketplace (provider sem chave de plano = liberado). */
  hasMarketplace(tenantId: string, provider: AffiliateProvider): Promise<boolean>;
}
