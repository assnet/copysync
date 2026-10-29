import type { StorefrontTemplateModel } from '../../domain/contracts/IStorefrontPageTemplate';
import type { StorefrontOffer } from '../../domain/entities/StorefrontOffer';
import { STOREFRONT_CATEGORIES } from '../../domain/services/storefrontCategories';
import { keepOfferCategory } from '../../domain/services/storefrontRules';

const LABELS: ReadonlyMap<string, string> = new Map(STOREFRONT_CATEGORIES.map((c) => [c.key, c.label]));

/** Endereço público da página: sempre https, `<slug>.<hostname>`. */
export function storefrontPublicUrl(hostname: string, slug: string): string {
  return `https://${slug}.${hostname}`;
}

export interface StorefrontModelSource {
  title: string;
  subtitle: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  colorPrimary: string;
  colorBackground: string;
  colorCard: string;
  categories: readonly string[];
}

/**
 * Página/rascunho + publicadas → modelo do template. Chave fora do catálogo some; categoria da
 * oferta que a página não mostra vira "Sem categoria" (mesma regra do painel).
 */
export function toStorefrontTemplateModel(
  page: StorefrontModelSource,
  offers: readonly StorefrontOffer[],
  publicUrl: string,
): StorefrontTemplateModel {
  const categories = page.categories.filter((k) => LABELS.has(k)).map((key) => ({ key, label: LABELS.get(key)! }));
  return {
    title: page.title,
    subtitle: page.subtitle,
    avatarUrl: page.avatarUrl,
    coverUrl: page.coverUrl,
    colors: { primary: page.colorPrimary, background: page.colorBackground, card: page.colorCard },
    categories,
    offers: offers.map((o) => {
      const categoryKey = keepOfferCategory(o.category, page.categories);
      return {
        title: o.title,
        priceCents: o.priceCents,
        originalPriceCents: o.originalPriceCents,
        imageUrl: o.imageUrl,
        categoryKey,
        categoryLabel: categoryKey ? LABELS.get(categoryKey) ?? null : null,
        affiliateUrl: o.affiliateUrl,
      };
    }),
    publicUrl,
  };
}
