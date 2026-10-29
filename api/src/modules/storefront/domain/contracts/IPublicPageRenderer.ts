/** Endereço público já separado do Host pelo hook (`<slug>.<domínio>`). */
export interface PublicPageAddress {
  domainId: string;
  slug: string;
}

export interface RenderedPublicPage {
  /** 200 página / "pausada" / "em breve"; 503 tenant inativo (design.md §4.2). */
  status: number;
  html: string;
  /** `sha256-…` do `<style>` inline, para a CSP da resposta. */
  styleHash: string;
}

/**
 * Página servida por subdomínio além do rodízio. O hook público tenta cada renderer em ordem:
 * null = endereço não é deste renderer (segue o fallback; nenhum → 404 da marca).
 */
export interface IPublicPageRenderer {
  render(address: PublicPageAddress): Promise<RenderedPublicPage | null>;
}
