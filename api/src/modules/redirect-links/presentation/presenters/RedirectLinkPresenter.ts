import type { RedirectLink } from '../../domain/entities/RedirectLink';

/** Domínio → HTTP (super-admin). `hitsTotal` = A + B. */
export const RedirectLinkPresenter = {
  link(l: RedirectLink) {
    return {
      id: l.id,
      slug: l.slug,
      urlA: l.urlA,
      urlB: l.urlB,
      percentA: l.percentA,
      isActive: l.isActive,
      hitsA: l.hitsA,
      hitsB: l.hitsB,
      hitsTotal: l.hitsA + l.hitsB,
      note: l.note,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    };
  },
};
