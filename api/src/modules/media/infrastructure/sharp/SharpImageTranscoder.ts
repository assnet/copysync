import sharp from 'sharp';
import type { IImageTranscoder, ResizedJpeg } from '../../domain/contracts/IImageTranscoder';
import { MediaProcessingFailedError } from '../../../../shared/errors/internal/MediaErrors';

/** Mesmo teto de pixels do sharp (≈ 16k × 16k), explícito para não depender do padrão. */
const MAX_INPUT_PIXELS = 268_402_689;
const JPEG_QUALITY = 85;

/** WebP → JPEG para foto do WhatsApp. Só a 1ª página de imagem animada. */
export class SharpImageTranscoder implements IImageTranscoder {
  async toJpeg(input: string, output: string): Promise<void> {
    try {
      await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toFile(output);
    } catch (err) {
      throw new MediaProcessingFailedError('Image could not be converted to JPEG', {
        reason: (err as Error)?.message?.slice(0, 120),
      });
    }
  }

  async resizeJpeg(input: string | Buffer, maxSide: number, quality: number): Promise<ResizedJpeg> {
    try {
      const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .flatten({ background: '#ffffff' })
        .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      return { buffer: data, width: info.width, height: info.height };
    } catch (err) {
      throw new MediaProcessingFailedError('Image could not be resized to JPEG', {
        reason: (err as Error)?.message?.slice(0, 120),
      });
    }
  }
}
