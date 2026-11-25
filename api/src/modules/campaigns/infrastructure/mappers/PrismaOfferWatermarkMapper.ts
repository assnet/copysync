import type { OfferWatermark as PrismaOfferWatermark } from '@prisma/client';
import type { OfferWatermark } from '../../domain/entities/OfferWatermark';
import type {
  OfferWatermarkKind,
  OfferWatermarkPosition,
  OfferWatermarkSize,
} from '../../domain/services/offerWatermarkRules';

/** Prisma → domínio. Enums têm valores idênticos (ver `offerWatermarkRules.ts`). */
export class PrismaOfferWatermarkMapper {
  static toDomain(raw: PrismaOfferWatermark): OfferWatermark {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      kind: raw.kind as OfferWatermarkKind,
      imageKey: raw.imageKey,
      text: raw.text,
      enabled: raw.enabled,
      position: raw.position as OfferWatermarkPosition,
      size: raw.size as OfferWatermarkSize,
      opacity: raw.opacity,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
