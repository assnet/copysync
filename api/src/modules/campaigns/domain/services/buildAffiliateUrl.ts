/** Link de afiliado Amazon: URL canônica do produto + `tag` do associado. */
export function buildAmazonAffiliateUrl(asin: string, trackingId: string): string {
  return `https://www.amazon.com.br/dp/${asin}?tag=${encodeURIComponent(trackingId)}`;
}

/**
 * Link de afiliado Mercado Livre: mesma página + `matt_word`.
 *
 * Descarta query e hash de origem — podem carregar rastreio de outro afiliado.
 */
export function buildMercadoLivreAffiliateUrl(url: URL, tag: string): string {
  return `${url.origin}${url.pathname}?matt_word=${encodeURIComponent(tag)}`;
}
