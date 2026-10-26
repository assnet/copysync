// Porta da API de afiliados da Shopee (GraphQL). Erros saem como Affiliate*Error, sem corpo nem segredo.

export interface ShopeeCredential {
  appId: string;
  secret: string;
}

export interface ShopeeProductRef {
  shopId: string;
  itemId: string;
}

export interface ShopeeProduct {
  title: string;
  imageUrl: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  offerLink: string | null;
}

export interface IShopeeAffiliateClient {
  /** null = produto não encontrado. */
  getProduct(cred: ShopeeCredential, ref: ShopeeProductRef): Promise<ShopeeProduct | null>;
  generateShortLink(cred: ShopeeCredential, originUrl: string, subIds?: string[]): Promise<string>;
}
