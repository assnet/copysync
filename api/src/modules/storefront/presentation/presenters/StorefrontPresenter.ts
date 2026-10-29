import type { GetStorefrontOutput } from '../../application/use-cases/GetStorefrontUseCase';
import type { Storefront } from '../../domain/entities/Storefront';
import type { StorefrontOffer } from '../../domain/entities/StorefrontOffer';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Saída HTTP da Página de Ofertas: datas em ISO, sem `tenantId`/`storefrontId`, nunca entidade crua. */
export const StorefrontPresenter = {
  storefront(p: Storefront) {
    return {
      id: p.id,
      title: p.title,
      subtitle: p.subtitle,
      avatarUrl: p.avatarUrl,
      coverUrl: p.coverUrl,
      colorPrimary: p.colorPrimary,
      colorBackground: p.colorBackground,
      colorCard: p.colorCard,
      categories: p.categories,
      status: p.status,
      domainId: p.address?.domainId ?? null,
      slug: p.address?.slug ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  },

  /** `attributionVerified = false` vira o selo "comissão não verificada" no painel. */
  offer(o: StorefrontOffer) {
    return {
      id: o.id,
      status: o.status,
      position: o.position,
      provider: o.provider,
      sourceUrl: o.sourceUrl,
      affiliateUrl: o.affiliateUrl,
      attributionVerified: o.attributionVerified,
      title: o.title,
      priceCents: o.priceCents,
      originalPriceCents: o.originalPriceCents,
      imageUrl: o.imageUrl,
      category: o.category,
      publishedAt: iso(o.publishedAt),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  },

  overview(out: GetStorefrontOutput) {
    return {
      storefront: out.storefront ? StorefrontPresenter.storefront(out.storefront) : null,
      publicUrl: out.publicUrl,
      offers: {
        drafts: out.offers.drafts.map(StorefrontPresenter.offer),
        published: out.offers.published.map(StorefrontPresenter.offer),
      },
      categories: out.categories,
      subtitleSuggestions: out.subtitleSuggestions,
      domains: out.domains,
    };
  },
};
