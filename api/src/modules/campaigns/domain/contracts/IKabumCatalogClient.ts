// Porta do catálogo público da Kabum (dados do produto; o link é montado à parte, via Awin).
// Erros saem como AffiliateApiUnavailableError, sem corpo nem URL.

export interface KabumProduct {
  title: string; // attributes.title, espaços colapsados
  priceCents: number; // oferta ativa → offer.price_with_discount; senão price_with_discount (à vista/PIX); senão price
  originalPriceCents: number | null; // old_price só se > preço (veio 0 nos exemplos reais) → senão null
  imageUrl: string | null; // images[0] ?? photos.gg|g|m|p[0], forçado para https, só host *.kabum.com.br
  available: boolean; // sempre true no que é devolvido: indisponível vira null
}

export interface IKabumCatalogClient {
  /**
   * Lança AffiliateApiUnavailableError (rede, timeout, 3xx, 5xx, corpo ilegível ou acima do teto).
   * null = produto inexistente (404), id inválido, indisponível ou sem título/preço: erro de produto, quem chama decide.
   */
  getProduct(productId: string): Promise<KabumProduct | null>;
}
