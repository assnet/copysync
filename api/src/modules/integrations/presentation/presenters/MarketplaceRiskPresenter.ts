import type { MarketplaceRiskAcceptance } from '../../domain/entities/MarketplaceRiskAcceptance';
import type { AcceptMarketplaceRiskOutput } from '../../application/use-cases/AcceptMarketplaceRiskUseCase';

export const MarketplaceRiskPresenter = {
  toAccepted(out: AcceptMarketplaceRiskOutput) {
    return { acceptedAt: out.acceptedAt.toISOString(), noticeVersion: out.noticeVersion, scope: out.scope };
  },
  toList(items: MarketplaceRiskAcceptance[]) {
    return items.map((a) => ({
      provider: a.provider,
      scope: a.scope,
      noticeVersion: a.noticeVersion,
      acceptedByUserId: a.acceptedByUserId,
      locale: a.locale,
      acceptedAt: a.acceptedAt.toISOString(),
    }));
  },
};
