import { readFile } from 'node:fs/promises';
import type { IOfferPreviewImage, OfferPreviewImages } from '../../domain/contracts/IOfferPreviewImage';
import type { IOfferImageDecorator } from '../../domain/contracts/IOfferImageDecorator';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { IImageTranscoder } from '../../../media/domain/contracts/IImageTranscoder';
import { logger } from '../../../../shared/logger/logger';

const log = logger.child({ module: 'OfferPreviewImage' });

export interface OfferPreviewImageDeps {
  files: () => IMediaFileStore;
  images: () => IImageTranscoder;
  /** Marca d'água do tenant; ausente = foto como está. */
  decorator?: () => IOfferImageDecorator;
  readFile?: (filePath: string) => Promise<Buffer>;
}

/**
 * Lê a foto da oferta pelo media store (vale para `offer-*.jpg` e para mídia do chat capturada
 * pelo monitoramento), aplica a marca d'água do tenant e gera as duas imagens da prévia — a
 * miniatura sai da foto já marcada. Só os bytes em memória mudam: o arquivo de origem
 * (`Offer.imageUrl`) nunca é regravado. Foto já reduzida passa direto (o transcoder nunca
 * amplia). Qualquer falha vira `null`; o log não leva a URL.
 */
export class OfferPreviewImage implements IOfferPreviewImage {
  constructor(private readonly deps: OfferPreviewImageDeps) {}

  async build(tenantId: string, imageUrl: string): Promise<OfferPreviewImages | null> {
    let acquired: Awaited<ReturnType<IMediaFileStore['acquireLocalFile']>> = null;
    try {
      acquired = await this.deps.files().acquireLocalFile(imageUrl);
      if (!acquired) {
        log.info('offer preview image unavailable in store');
        return null;
      }
      const bytes = await (this.deps.readFile ?? readFile)(acquired.filePath);
      // O decorador nunca lança: sem marca ou em erro devolve os mesmos bytes
      const photo = this.deps.decorator ? await this.deps.decorator().decorate(tenantId, bytes) : bytes;
      const images = this.deps.images();
      const image = await images.resizeJpeg(photo, 600, 75);
      const thumb = await images.resizeJpeg(photo, 192, 70);
      return { imageJpeg: image.buffer, thumbnailJpeg: thumb.buffer };
    } catch (err) {
      log.warn({ err: (err as Error)?.name }, 'offer preview image failed');
      return null;
    } finally {
      if (acquired) await acquired.release().catch(() => undefined);
    }
  }
}
