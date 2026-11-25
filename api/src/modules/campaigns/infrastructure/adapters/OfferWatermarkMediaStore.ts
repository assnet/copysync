import { readFile } from 'node:fs/promises';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { IOfferWatermarkMediaStore } from '../../domain/contracts/IOfferWatermarkMediaStore';

/** Único formato de chave aceito (gravado pela T30); nunca lê objeto arbitrário do storage. */
export const OFFER_WATERMARK_LOGO_KEY = /^offer-watermark-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i;

export interface OfferWatermarkMediaStoreDeps {
  files: () => IMediaFileStore;
  readFile?: (filePath: string) => Promise<Buffer>;
}

/**
 * Logo da marca d'água no media store. Molde: `StorefrontMediaStore`. Lido a cada envio, sem
 * cache em memória (ajuste novo vale no envio seguinte). Gravar/apagar: T30.
 */
export class OfferWatermarkMediaStore implements IOfferWatermarkMediaStore {
  constructor(private readonly deps: OfferWatermarkMediaStoreDeps) {}

  async read(imageKey: string): Promise<Buffer | null> {
    if (!OFFER_WATERMARK_LOGO_KEY.test(imageKey)) return null;
    const files = this.deps.files();
    const acquired = await files.acquireLocalFile(files.publicUrl(imageKey));
    if (!acquired) return null;
    try {
      return await (this.deps.readFile ?? readFile)(acquired.filePath);
    } finally {
      await acquired.release().catch(() => undefined);
    }
  }
}
