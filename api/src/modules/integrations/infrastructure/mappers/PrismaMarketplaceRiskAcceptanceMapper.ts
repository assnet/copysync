import type { MarketplaceRiskAcceptance as PrismaMarketplaceRiskAcceptance } from '@prisma/client';
import type { MarketplaceRiskAcceptance } from '../../domain/entities/MarketplaceRiskAcceptance';

/** Prisma → domínio. */
export class PrismaMarketplaceRiskAcceptanceMapper {
  static toDomain(raw: PrismaMarketplaceRiskAcceptance): MarketplaceRiskAcceptance {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      provider: raw.provider,
      noticeVersion: raw.noticeVersion,
      acceptedByUserId: raw.acceptedByUserId,
      locale: raw.locale,
      acceptedAt: raw.acceptedAt,
    };
  }
}
