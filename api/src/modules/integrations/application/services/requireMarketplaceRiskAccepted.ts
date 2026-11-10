import type { IMarketplaceRiskAcceptanceRepository } from '../../domain/contracts/IMarketplaceRiskAcceptanceRepository';
import type { AffiliateProvider } from '../../domain/enums/AffiliateProvider';
import { currentRiskNoticeVersion } from '../../domain/services/marketplaceRiskNotice';
import { MarketplaceRiskNotAcceptedError } from '../../../../shared/errors/internal/MarketplaceRiskErrors';

/** true quando o provider não tem aviso ou o tenant aceitou a versão vigente. */
export async function isMarketplaceRiskAccepted(
  repo: IMarketplaceRiskAcceptanceRepository,
  tenantId: string,
  provider: AffiliateProvider,
): Promise<boolean> {
  const version = currentRiskNoticeVersion(provider);
  if (version === null) return true;
  return (await repo.findCurrent(tenantId, provider, version)) !== null;
}

/** Lança `MarketplaceRiskNotAcceptedError` (403) sem aceite da versão vigente. Provider sem aviso passa. */
export async function requireMarketplaceRiskAccepted(
  repo: IMarketplaceRiskAcceptanceRepository,
  tenantId: string,
  provider: AffiliateProvider,
): Promise<void> {
  const version = currentRiskNoticeVersion(provider);
  if (version === null) return;
  if ((await repo.findCurrent(tenantId, provider, version)) === null) {
    throw new MarketplaceRiskNotAcceptedError(provider, version);
  }
}
