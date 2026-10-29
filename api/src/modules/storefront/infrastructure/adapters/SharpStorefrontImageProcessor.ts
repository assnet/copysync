import sharp from 'sharp';
import type {
  IStorefrontImageProcessor,
  ProcessedStorefrontImage,
} from '../../domain/contracts/IStorefrontImageProcessor';
import {
  STOREFRONT_IMAGE_MAX_INPUT_PIXELS,
  STOREFRONT_IMAGE_PRESETS,
  STOREFRONT_IMAGE_WEBP_QUALITY,
  type StorefrontImageKind,
} from '../../domain/services/storefrontRules';
import { AppError } from '../../../../shared/errors/AppError';
import {
  MediaProcessingFailedError,
  MediaTooLargeError,
  UnsupportedMediaTypeError,
} from '../../../../shared/errors/internal/MediaErrors';

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

/**
 * Foto, capa e imagem de oferta da página (design.md §4.5). O formato vem do conteúdo
 * (`metadata()`), nunca do mime declarado; só a 1ª página de imagem animada é usada.
 * `rotate()` aplica a orientação EXIF e a saída WebP não leva metadados.
 */
export class SharpStorefrontImageProcessor implements IStorefrontImageProcessor {
  async process(input: Buffer, kind: StorefrontImageKind): Promise<ProcessedStorefrontImage> {
    const preset = STOREFRONT_IMAGE_PRESETS[kind];
    if (input.length > preset.maxInputBytes) {
      throw new MediaTooLargeError(undefined, { kind, maxBytes: preset.maxInputBytes });
    }

    const source = () => sharp(input, { limitInputPixels: STOREFRONT_IMAGE_MAX_INPUT_PIXELS });

    let meta: sharp.Metadata;
    try {
      meta = await source().metadata();
    } catch {
      throw new UnsupportedMediaTypeError('Only JPEG, PNG or WebP images are accepted', { kind });
    }
    if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
      throw new UnsupportedMediaTypeError('Only JPEG, PNG or WebP images are accepted', { kind });
    }

    // Dimensão já orientada (EXIF 5–8 troca largura e altura).
    const width = meta.autoOrient?.width ?? meta.width ?? 0;
    const height = meta.autoOrient?.height ?? meta.height ?? 0;
    if (width * height > STOREFRONT_IMAGE_MAX_INPUT_PIXELS) {
      throw new MediaTooLargeError('Image has too many pixels', { kind });
    }
    if (width < preset.minWidth || height < preset.minHeight) {
      throw new MediaProcessingFailedError('Image is smaller than the minimum size', {
        kind,
        minWidth: preset.minWidth,
        minHeight: preset.minHeight,
      });
    }

    const { output } = preset;
    try {
      const { data, info } = await source()
        .rotate()
        .resize(output.width, output.height, {
          fit: output.fit,
          ...(output.fit === 'inside' ? { withoutEnlargement: true } : { position: 'centre' }),
        })
        .webp({ quality: STOREFRONT_IMAGE_WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
      return { buffer: data, width: info.width, height: info.height };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new MediaProcessingFailedError(undefined, { kind });
    }
  }
}
