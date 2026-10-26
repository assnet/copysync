import type { ProductPageData } from '../services/parseProductPage';

export interface ReadProductPageInput {
  url: URL;
  /**
   * Sessão do afiliado no Mercado Livre (cookie `ssid`). Só vai para host do ML; nunca é
   * logada nem devolvida.
   */
  mercadoLivreSessionToken?: string | null;
}

/** Lê a página pública do produto. null = página indisponível. Nunca lança por falha de rede. */
export interface IProductPageReader {
  read(input: ReadProductPageInput): Promise<ProductPageData | null>;
}
