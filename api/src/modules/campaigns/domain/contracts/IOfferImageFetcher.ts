// Baixa a foto do produto (host em allowlist, image/*, tamanho limitado).

export interface FetchedOfferImage {
  buffer: Buffer;
  mimeType: string;
}

export interface IOfferImageFetcher {
  /** null = não baixável. Nunca lança por falha de rede. */
  fetch(url: string): Promise<FetchedOfferImage | null>;
}
