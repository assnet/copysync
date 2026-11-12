import type { IMarketplaceRiskAcceptanceRepository } from '../../domain/contracts/IMarketplaceRiskAcceptanceRepository';
import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import type { MarketplaceRiskScope } from '../../domain/enums/MarketplaceRiskScope';
import { DEFAULT_MARKETPLACE_RISK_SCOPE } from '../../domain/enums/MarketplaceRiskScope';
import { currentRiskNoticeVersion } from '../../domain/services/marketplaceRiskNotice';
import { MarketplaceRiskNotAcceptedError } from '../../../../shared/errors/internal/MarketplaceRiskErrors';

/** true quando o provider não tem aviso no escopo ou o tenant aceitou a versão vigente desse escopo. */
export async function isMarketplaceRiskAccepted(
  repo: IMarketplaceRiskAcceptanceRepository,
  tenantId: string,
  provider: AffiliateProvider,
  scope: MarketplaceRiskScope = DEFAULT_MARKETPLACE_RISK_SCOPE,
): Promise<boolean> {
  const version = currentRiskNoticeVersion(provider, scope);
  if (version === null) return true;
  return (await repo.findCurrent(tenantId, provider, scope, version)) !== null;
}

/** Lança `MarketplaceRiskNotAcceptedError` (403) sem aceite da versão vigente do escopo. Provider sem aviso passa. */
export async function requireMarketplaceRiskAccepted(
  repo: IMarketplaceRiskAcceptanceRepository,
  tenantId: string,
  provider: AffiliateProvider,
  scope: MarketplaceRiskScope = DEFAULT_MARKETPLACE_RISK_SCOPE,
): Promise<void> {
  const version = currentRiskNoticeVersion(provider, scope);
  if (version === null) return;
  if ((await repo.findCurrent(tenantId, provider, scope, version)) === null) {
    throw new MarketplaceRiskNotAcceptedError(provider, version, scope);
  }
}
