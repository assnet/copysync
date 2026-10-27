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
      coupon: raw.coupon,
      audience: raw.audience,
      mentionAll: raw.mentionAll,
      simulateTyping: raw.simulateTyping,
      typingSeconds: raw.typingSeconds,
      scheduledAt: raw.scheduledAt,
      origin: raw.origin,
      expiresAt: raw.expiresAt,
      sourceKey: raw.sourceKey,
      status: raw.status,
      createdById: raw.createdById,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
