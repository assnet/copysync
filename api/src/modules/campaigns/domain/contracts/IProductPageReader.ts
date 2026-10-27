import type { ProductPageData } from '../services/parseProductPage';

export interface ReadProductPageInput {
  url: URL;
  mercadoLivreCookies?: Record<string, string> | null;
}

/** Lê a página pública do produto. null = página indisponível. Nunca lança por falha de rede. */
export interface IProductPageReader {
  read(input: ReadProductPageInput): Promise<ProductPageData | null>;
}
