// Imagens da prévia de link da oferta, a partir da foto já armazenada (docs/mensagens-previa-de-link.md).

export interface OfferPreviewImages {
  /** JPEG ≤ 600 px (cartão grande). */
  imageJpeg: Buffer;
  /** JPEG ≤ 192 px (miniatura embutida na mensagem). */
  thumbnailJpeg: Buffer;
}

export interface IOfferPreviewImage {
  /**
   * Imagem e miniatura com a marca d'água do tenant, quando aplicável (a foto de origem nunca muda).
   * `null` = URL fora do store, arquivo sumido ou foto ilegível: a oferta sai como texto puro. Nunca lança.
   */
  build(tenantId: string, imageUrl: string): Promise<OfferPreviewImages | null>;
}
