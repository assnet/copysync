import type { StorefrontOffer as PrismaStorefrontOffer } from '@prisma/client';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { StorefrontOffer } from '../../domain/entities/StorefrontOffer';
import type { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';

/** Prisma → domínio. Enums têm valores idênticos (ver StorefrontEnums / AffiliateProvider). */
export class PrismaStorefrontOfferMapper {
  static toDomain(raw: PrismaStorefrontOffer): StorefrontOffer {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      storefrontId: raw.storefrontId,
      status: raw.status as StorefrontOfferStatus,
      position: raw.position,
      provider: raw.provider as AffiliateProvider,
      sourceUrl: raw.sourceUrl,
      affiliateUrl: raw.affiliateUrl,
      attributionVerified: raw.attributionVerified,
      title: raw.title,
      priceCents: raw.priceCents,
      originalPriceCents: raw.originalPriceCents,
      imageUrl: raw.imageUrl,
      category: raw.category,
      publishedAt: raw.publishedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
