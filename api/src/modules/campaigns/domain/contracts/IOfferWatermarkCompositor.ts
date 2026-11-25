import type { OfferWatermarkPosition, OfferWatermarkSize } from '../services/offerWatermarkRules';

/** Fonte da marca já carregada: logo (bytes) ou texto. Uma só, nunca as duas. */
export type OfferWatermarkMark = { kind: 'IMAGE'; logo: Buffer } | { kind: 'TEXT'; text: string };

export interface OfferWatermarkLayout {
  position: OfferWatermarkPosition;
  size: OfferWatermarkSize;
  /** 20–100 (%). */
  opacity: number;
}

/** Desenha a marca sobre a foto (tamanho e lugar por `computeWatermarkPlacement`). */
export interface IOfferWatermarkCompositor {
  /**
   * Foto JPEG, PNG ou WebP → JPEG do mesmo tamanho (orientação EXIF aplicada) com a marca.
   * @throws foto ou logo ilegível, fonte ausente.
   */
  compose(photo: Buffer, mark: OfferWatermarkMark, layout: OfferWatermarkLayout): Promise<Buffer>;
}
