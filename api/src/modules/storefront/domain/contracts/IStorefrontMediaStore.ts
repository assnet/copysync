/**
 * Arquivos da página (foto, capa, imagem de oferta) no storage de mídia. Nome sempre
 * `storefront-<uuid>.webp`; `remove` ignora qualquer URL fora desse padrão e nunca lança.
 */
export interface IStorefrontMediaStore {
  save(buffer: Buffer): Promise<string>;
  remove(url: string): Promise<void>;
}
