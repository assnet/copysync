import type { RedirectLink as PrismaRedirectLink } from '@prisma/client';
import type { RedirectLink } from '../../domain/entities/RedirectLink';

/** Prisma → domínio (link de redirecionamento da plataforma). */
export class PrismaRedirectLinkMapper {
  static toDomain(raw: PrismaRedirectLink): RedirectLink {
    return {
      id: raw.id,
      slug: raw.slug,
      urlA: raw.urlA,
      urlB: raw.urlB,
      percentA: raw.percentA,
      isActive: raw.isActive,
      hitsA: raw.hitsA,
      hitsB: raw.hitsB,
      note: raw.note,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
