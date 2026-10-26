import type { Offer as PrismaOffer } from '@prisma/client';
import type { Offer } from '../../domain/entities/Offer';

/** Prisma → domínio. */
export class PrismaOfferMapper {
  static toDomain(raw: PrismaOffer): Offer {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      provider: raw.provider,
      sourceUrl: raw.sourceUrl,
      productRef: raw.productRef,
      title: raw.title,
      priceCents: raw.priceCents,
      originalPriceCents: raw.originalPriceCents,
      imageUrl: raw.imageUrl,
      affiliateUrl: raw.affiliateUrl,
      attributionVerified: raw.attributionVerified,
      text: raw.text,
      textEdited: raw.textEdited,
      status: raw.status,
      createdById: raw.createdById,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
