/**
 * Marca d'água própria aplicada no envio, sobre a foto limpa da oferta (spec IMG-08…10/14; design.md
 * "Imagem das ofertas"). O arquivo de `Offer.imageUrl` nunca é alterado.
 *
 * `kind` do registro escolhe UMA fonte da marca: `IMAGE` usa o logo, `TEXT` usa o texto; nunca compõe
 * as duas, mesmo com as duas guardadas.
 */
export interface IOfferImageDecorator {
  /**
   * Plano com `offer_watermark_enabled`, marca ligada e dado do tipo escolhido presente (logo ou texto).
   * É o que decide o ramo do Telegram. Nunca lança: erro de leitura = `false`.
   */
  applies(tenantId: string): Promise<boolean>;
  /**
   * Foto de origem JPEG, PNG ou WebP → JPEG com a marca. Sem plano, desligada, sem a marca do tipo
   * escolhido ou em erro (logo sumido, storage fora): devolve a foto intacta e loga, nunca lança.
   */
  decorate(tenantId: string, image: Buffer): Promise<Buffer>;
}
