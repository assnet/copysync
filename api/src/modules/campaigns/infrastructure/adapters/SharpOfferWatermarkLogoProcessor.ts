import sharp from 'sharp';
import type {
  IOfferWatermarkLogoProcessor,
  NormalizedOfferWatermarkLogo,
} from '../../domain/contracts/IOfferWatermarkLogoProcessor';
import {
  OFFER_WATERMARK_LOGO_FORMATS,
  OFFER_WATERMARK_LOGO_MAX_BYTES,
  OFFER_WATERMARK_LOGO_MIN_SIDE,
  OFFER_WATERMARK_LOGO_NORMALIZED_MAX_SIDE,
} from '../../domain/services/offerWatermarkRules';
import { AppError } from '../../../../shared/errors/AppError';
import {
  MediaProcessingFailedError,
  MediaTooLargeError,
  UnsupportedMediaTypeError,
} from '../../../../shared/errors/internal/MediaErrors';

/** Teto de pixels da entrada (anti bomba de descompressão; 1 MiB comprimido pode abrir enorme). */
export const OFFER_WATERMARK_LOGO_MAX_INPUT_PIXELS = 25_000_000;

const FORMATS: ReadonlySet<string> = new Set(OFFER_WATERMARK_LOGO_FORMATS);
const TYPE_MESSAGE = 'Only PNG or WebP images with transparency are accepted';

/**
 * Logo da marca d'água (spec IMG-06). Molde: `SharpStorefrontImageProcessor`. Formato e alfa vêm do
 * conteúdo (`metadata()`), nunca do mime; imagem animada usa só a 1ª página. Saída PNG sem metadados.
 *
 * Menor que 100×100 → `MEDIA_PROCESSING_FAILED` (422), como o mínimo de foto/capa da página: o tipo é
 * aceito e o tamanho não estourou, o conteúdo é que não serve (nem 413 nem 415 descrevem isso).
 */
export class SharpOfferWatermarkLogoProcessor implements IOfferWatermarkLogoProcessor {
  async normalize(input: Buffer): Promise<NormalizedOfferWatermarkLogo> {
    if (input.length > OFFER_WATERMARK_LOGO_MAX_BYTES) {
      throw new MediaTooLargeError(undefined, { maxBytes: OFFER_WATERMARK_LOGO_MAX_BYTES });
    }

    const source = () => sharp(input, { limitInputPixels: OFFER_WATERMARK_LOGO_MAX_INPUT_PIXELS });

    let meta: sharp.Metadata;
    try {
      meta = await source().metadata();
    } catch {
      // Não é imagem reconhecível (ex.: texto com extensão .png): tipo, não processamento
      throw new UnsupportedMediaTypeError(TYPE_MESSAGE);
    }
    if (!meta.format || !FORMATS.has(meta.format) || meta.hasAlpha !== true) {
      throw new UnsupportedMediaTypeError(TYPE_MESSAGE, { format: meta.format ?? null });
    }

    const width = meta.autoOrient?.width ?? meta.width ?? 0;
    const height = meta.autoOrient?.height ?? meta.height ?? 0;
    if (width * height > OFFER_WATERMARK_LOGO_MAX_INPUT_PIXELS) {
      throw new MediaTooLargeError('Image has too many pixels');
    }
    if (width < OFFER_WATERMARK_LOGO_MIN_SIDE || height < OFFER_WATERMARK_LOGO_MIN_SIDE) {
      throw new MediaProcessingFailedError('Image is smaller than the minimum size', {
        minWidth: OFFER_WATERMARK_LOGO_MIN_SIDE,
        minHeight: OFFER_WATERMARK_LOGO_MIN_SIDE,
      });
    }

    const side = OFFER_WATERMARK_LOGO_NORMALIZED_MAX_SIDE;
    try {
      const { data, info } = await source()
        .rotate()
        .resize(side, side, { fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
      return { buffer: data, width: info.width, height: info.height };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new MediaProcessingFailedError();
    }
  }
}
