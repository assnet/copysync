import type { PremiumSlugGrant as PrismaPremiumSlugGrant } from '@prisma/client';
import type { PremiumSlugGrant } from '../../domain/entities/PremiumSlugGrant';

/** Prisma → domínio (liberação de nome premium). */
export class PrismaPremiumSlugGrantMapper {
  static toDomain(raw: PrismaPremiumSlugGrant): PremiumSlugGrant {
    return {
      id: raw.id,
      domainId: raw.domainId,
      slug: raw.slug,
      tenantId: raw.tenantId,
      source: raw.source,
      expiresAt: raw.expiresAt,
      createdAt: raw.createdAt,
    };
  }
}
