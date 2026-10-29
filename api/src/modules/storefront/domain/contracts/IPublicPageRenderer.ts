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
  // SPEC_DEVIATION: §4.2 não lista o campo. Reason: o hook não distingue 200 pausada/em breve de 200 com ofertas só pelo status.
  /** true só no 200 com ofertas (`Cache-Control: public, max-age=60`, §4.2); demais = no-store. */
  cacheable?: boolean;
}

/**
 * Página servida por subdomínio além do rodízio. O hook público tenta cada renderer em ordem:
 * null = endereço não é deste renderer (segue o fallback; nenhum → 404 da marca).
 */
export interface IPublicPageRenderer {
  render(address: PublicPageAddress): Promise<RenderedPublicPage | null>;
}
