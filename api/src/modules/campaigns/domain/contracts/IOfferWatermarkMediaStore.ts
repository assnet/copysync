/**
 * Logo da marca d'água no media store (`offer-watermark-<uuid>.png`, normalizado no upload).
 * `imageKey` do registro é o nome do arquivo; nunca sai na resposta HTTP (sai só `publicUrl`).
 * Padrão de `IStorefrontMediaStore`: só lê, apaga ou expõe chaves deste formato.
 */
export interface IOfferWatermarkMediaStore {
  /**
   * Bytes do logo. `null` = chave fora do formato ou arquivo sumido.
   * @throws erro do storage (fora do ar, leitura falhou): quem decora trata e envia sem a marca.
   */
  read(imageKey: string): Promise<Buffer | null>;
  /** Grava o PNG já normalizado com nome novo; devolve a chave (`offer-watermark-<uuid>.png`). */
  save(png: Buffer): Promise<string>;
  /** Apaga o logo. Chave fora do formato: não toca o storage. Falha só é logada (`false`). */
  remove(imageKey: string): Promise<boolean>;
  /** URL do logo para o painel (mesmo padrão do storefront); `null` = chave fora do formato. */
  publicUrl(imageKey: string): string | null;
}
