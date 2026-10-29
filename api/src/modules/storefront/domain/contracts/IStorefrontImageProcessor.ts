import type { StorefrontImageKind } from '../services/storefrontRules';

export interface ProcessedStorefrontImage {
  /** WebP sem metadados (EXIF removido). */
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * Valida e redimensiona imagem conforme `STOREFRONT_IMAGE_PRESETS[kind]` (design.md §4.5).
 * Formato detectado pelo conteúdo, nunca pelo mime declarado. Lança erro interno de mídia
 * (`UNSUPPORTED_MEDIA_TYPE` / `MEDIA_PROCESSING_FAILED` / `MEDIA_TOO_LARGE`), nunca erro cru da lib.
 */
export interface IStorefrontImageProcessor {
  process(input: Buffer, kind: StorefrontImageKind): Promise<ProcessedStorefrontImage>;
}
