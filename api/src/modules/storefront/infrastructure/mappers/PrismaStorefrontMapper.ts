import type { PublicSlugClaim as PrismaPublicSlugClaim, Storefront as PrismaStorefront } from '@prisma/client';
import type { Storefront } from '../../domain/entities/Storefront';
import type { StorefrontStatus } from '../../domain/enums/StorefrontEnums';

/** Linha da página com o claim (relation `claim`): o endereço sai dele, nunca de coluna da página. */
export type PrismaStorefrontWithClaim = PrismaStorefront & {
  claim: Pick<PrismaPublicSlugClaim, 'domainId' | 'slug'> | null;
};

/** Prisma → domínio. Enums têm valores idênticos (ver StorefrontEnums). */
export class PrismaStorefrontMapper {
  static toDomain(raw: PrismaStorefrontWithClaim): Storefront {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      title: raw.title,
      subtitle: raw.subtitle,
      avatarUrl: raw.avatarUrl,
      coverUrl: raw.coverUrl,
      colorPrimary: raw.colorPrimary,
      colorBackground: raw.colorBackground,
      colorCard: raw.colorCard,
      categories: [...raw.categories],
      status: raw.status as StorefrontStatus,
      address: raw.claim ? { domainId: raw.claim.domainId, slug: raw.claim.slug } : null,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
