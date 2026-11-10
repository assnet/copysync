import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';

/**
 * Aceite do aviso de risco do marketplace (versão vigente). Adapter sobre o repositório de
 * `integrations`. Quem chama só consulta para provider com `requiresRiskAcceptance` e com credencial.
 */
export interface IMarketplaceRiskGate {
  isAccepted(tenantId: string, provider: AffiliateProvider): Promise<boolean>;
}
