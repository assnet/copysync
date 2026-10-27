// Porta da API de afiliados do Mercado Livre (não documentada; requer sessão de navegador).
// Erros saem como Affiliate*Error, sem corpo nem segredo.

export interface MlAffiliateLinkItem {
  originUrl: string;
  shortUrl: string;
  longUrl: string;
}

export interface MlAffiliateLinkError {
  originUrl: string;
  errorCode: number;
  message: string;
}

export interface MlCreateLinksResult {
  success: MlAffiliateLinkItem[];
  errors: MlAffiliateLinkError[];
}

export interface IMercadoLivreAffiliateClient {
  /** Gera links de afiliado (até 20 por chamada). Tag opcional: se omitida, usa a ativa. */
  createAffiliateLinks(
    cookies: Record<string, string>,
    urls: string[],
    tag?: string,
  ): Promise<MlCreateLinksResult>;

  /** Tag ativa do programa de afiliados. null se nenhuma está ativa. */
  getActiveTag(cookies: Record<string, string>): Promise<string | null>;
}
