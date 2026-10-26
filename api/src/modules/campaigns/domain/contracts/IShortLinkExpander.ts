// Expande link curto de marketplace até a URL final, revalidando cada salto.

export interface IShortLinkExpander {
  /** Lança OfferUrlUnsupportedError se algum salto sair da allowlist. */
  expand(url: URL): Promise<URL>;
}
