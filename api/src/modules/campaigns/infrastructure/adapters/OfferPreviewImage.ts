import type { IOfferPreviewImage, OfferPreviewImages } from '../../domain/contracts/IOfferPreviewImage';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { IImageTranscoder } from '../../../media/domain/contracts/IImageTranscoder';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'OfferPreviewImage' });

export interface OfferPreviewImageDeps {
  files: () => IMediaFileStore;
  images: () => IImageTranscoder;
}

/**
 * Lê a foto da oferta pelo media store (vale para `offer-*.jpg` e para mídia do chat capturada
 * pelo monitoramento) e gera as duas imagens da prévia. Foto já reduzida passa direto (o
 * transcoder nunca amplia). Qualquer falha vira `null`; o log não leva a URL.
 */
export class OfferPreviewImage implements IOfferPreviewImage {
  constructor(private readonly deps: OfferPreviewImageDeps) {}

  async build(imageUrl: string): Promise<OfferPreviewImages | null> {
    let acquired: Awaited<ReturnType<IMediaFileStore['acquireLocalFile']>> = null;
    try {
      acquired = await this.deps.files().acquireLocalFile(imageUrl);
      if (!acquired) {
        log.info('offer preview image unavailable in store');
        return null;
      }
      const images = this.deps.images();
      const image = await images.resizeJpeg(acquired.filePath, 600, 75);
      const thumb = await images.resizeJpeg(acquired.filePath, 192, 70);
      return { imageJpeg: image.buffer, thumbnailJpeg: thumb.buffer };
    } catch (err) {
      log.warn({ err: (err as Error)?.name }, 'offer preview image failed');
      return null;
    } finally {
      if (acquired) await acquired.release().catch(() => undefined);
    }
  }
}
