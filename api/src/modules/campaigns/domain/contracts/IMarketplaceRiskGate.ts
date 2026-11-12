import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { MarketplaceRiskScope } from '../../../integrations/domain/enums/MarketplaceRiskScope';

/**
 * Aceite do aviso de risco do marketplace (versão vigente). Adapter sobre o repositório de
 * `integrations`. Quem chama só consulta para provider com `requiresRiskAcceptance` e com credencial.
 * `scope` ausente = `AFFILIATE_LINK` (aviso do marketplace); o caçador passa `OFFER_HUNTER`.
 */
export interface IMarketplaceRiskGate {
  isAccepted(tenantId: string, provider: AffiliateProvider, scope?: MarketplaceRiskScope): Promise<boolean>;
}
