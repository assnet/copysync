/**
 * HTML da Página de Ofertas (pública e prévia). Porta para a aplicação não importar a
 * presentation: a composição liga `renderStorefrontPage`/`storefrontComingSoonPage`/
 * `storefrontPausedPage` (+ `unavailablePage` do rodízio) e fixa as origens de mídia e marca.
 * Os tipos espelham `presentation/templates/renderStorefrontPage.ts` (compatíveis por estrutura).
 *
 * SPEC_DEVIATION: design §4.3 chama o template direto do use case. Reason: application não importa
 * presentation (AGENTS.md §8); a porta mantém o use case testável sem HTML real.
 */

export interface StorefrontTemplateOffer {
  title: string;
  priceCents: number | null;
  originalPriceCents: number | null;
  imageUrl: string | null;
  categoryKey: string | null;
  categoryLabel: string | null;
  affiliateUrl: string;
}

/** Strings cruas: o template escapa tudo e normaliza cores fora de `#RRGGBB`. */
export interface StorefrontTemplateModel {
  title: string;
  subtitle: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  colors: { primary: string; background: string; card: string };
  categories: { key: string; label: string }[];
  /** Publicadas, na ordem. Vazio na prévia = exemplos fixos com selo. */
  offers: StorefrontTemplateOffer[];
  publicUrl: string;
}

export interface StorefrontTemplateOptions {
  isPreview: boolean;
  viewport?: 'mobile' | 'desktop';
}

export interface StorefrontTemplateResult {
  html: string;
  /** `sha256-<base64>` do `<style>` para a CSP da resposta. */
  styleHash: string;
}

export interface IStorefrontPageTemplate {
  page(model: StorefrontTemplateModel, opts: StorefrontTemplateOptions): StorefrontTemplateResult;
  /** Ativa sem publicadas (200). */
  comingSoon(title: string): StorefrontTemplateResult;
  /** Pausada pelo plano (200). */
  paused(title: string): StorefrontTemplateResult;
  /** Tenant inativo (503): página genérica da marca, sem dado do tenant. */
  unavailable(): StorefrontTemplateResult;
}
