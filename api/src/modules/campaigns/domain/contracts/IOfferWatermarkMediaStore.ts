/**
 * Logo da marca d'água no media store (`offer-watermark-<uuid>.png`, normalizado no upload).
 * `imageKey` do registro é o nome do arquivo; nunca sai na resposta HTTP.
 *
 * A T29 só lê. Gravar e apagar (upload do logo, troca e remoção) entram aqui na T30, no padrão de
 * `IStorefrontMediaStore` (`save`/`remove`), aceitando só chaves deste formato.
 */
export interface IOfferWatermarkMediaStore {
  /**
   * Bytes do logo. `null` = chave fora do formato ou arquivo sumido.
   * @throws erro do storage (fora do ar, leitura falhou): quem decora trata e envia sem a marca.
   */
  read(imageKey: string): Promise<Buffer | null>;
}
