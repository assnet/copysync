import type { IMarketplaceRiskAcceptanceRepository } from '../../domain/contracts/IMarketplaceRiskAcceptanceRepository';
import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import type { MarketplaceRiskScope } from '../../domain/enums/MarketplaceRiskScope';
import { DEFAULT_MARKETPLACE_RISK_SCOPE } from '../../domain/enums/MarketplaceRiskScope';
import { currentRiskNoticeVersion, isRiskScopeFailClosed } from '../../domain/services/marketplaceRiskNotice';
import { MarketplaceRiskNotAcceptedError } from '../../../../shared/errors/internal/MarketplaceRiskErrors';

/**
 * true quando o tenant aceitou a versão vigente do escopo. Provider sem aviso: passa no `AFFILIATE_LINK`,
 * bloqueia no `OFFER_HUNTER` (fail-closed: marca nova no caçador sem aviso próprio nunca roda).
 */
export async function isMarketplaceRiskAccepted(
  repo: IMarketplaceRiskAcceptanceRepository,
  tenantId: string,
  provider: AffiliateProvider,
  scope: MarketplaceRiskScope = DEFAULT_MARKETPLACE_RISK_SCOPE,
): Promise<boolean> {
  const version = currentRiskNoticeVersion(provider, scope);
  if (version === null) return !isRiskScopeFailClosed(scope);
  return (await repo.findCurrent(tenantId, provider, scope, version)) !== null;
}

/**
 * Lança `MarketplaceRiskNotAcceptedError` (403) sem aceite da versão vigente do escopo. Provider sem aviso
 * passa no `AFFILIATE_LINK` e é recusado (versão `''`) no `OFFER_HUNTER`.
 */
export async function requireMarketplaceRiskAccepted(
  repo: IMarketplaceRiskAcceptanceRepository,
  tenantId: string,
  provider: AffiliateProvider,
  scope: MarketplaceRiskScope = DEFAULT_MARKETPLACE_RISK_SCOPE,
): Promise<void> {
  const version = currentRiskNoticeVersion(provider, scope);
  if (version === null) {
    if (isRiskScopeFailClosed(scope)) throw new MarketplaceRiskNotAcceptedError(provider, '', scope);
    return;
  }
  if ((await repo.findCurrent(tenantId, provider, scope, version)) === null) {
    throw new MarketplaceRiskNotAcceptedError(provider, version, scope);
  }
}
