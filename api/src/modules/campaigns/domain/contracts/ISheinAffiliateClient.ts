// Porta do programa de afiliados da Shein (link de divulgação de um produto). Erros saem como
// Affiliate*Error, sem token, corpo nem URL do produto.

export interface SheinSession {
  token: string;
  memberId: string;
}

export interface SheinProductShare {
  affiliateUrl: string; // info.shareLink; só https em onelink.shein.com — ausente/vazio/outro host → o método devolve null
  title: string | null; // goodsBasicInfo.goodsName, espaços colapsados
  priceCents: number | null; // salesPrice vem em REAIS (observado 29.99 com salesPriceText "R$29,99") → Math.round(x * 100); não numérico → null
  originalPriceCents: number | null; // retailPrice ("R$50,00") via parser BRL existente; null se ≤ preço
  imageUrl: string | null; // mainImageOfOriginImage ?? mainImage, forçado para https
}

export interface ISheinAffiliateClient {
  /** Lança AffiliateCredentialRejectedError (sessão recusada) ou AffiliateApiUnavailableError. null = produto sem link. */
  getProductShare(session: SheinSession, goodsId: string): Promise<SheinProductShare | null>;
}
