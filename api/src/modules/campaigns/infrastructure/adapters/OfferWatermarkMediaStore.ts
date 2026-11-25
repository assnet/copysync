import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { IOfferWatermarkMediaStore } from '../../domain/contracts/IOfferWatermarkMediaStore';
import { logger } from '../../../../shared/logger/logger';

/** Único formato de chave aceito (gravado por `save`); nunca lê nem apaga objeto arbitrário do storage. */
export const OFFER_WATERMARK_LOGO_KEY = /^offer-watermark-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i;

export interface OfferWatermarkMediaStoreDeps {
  files: () => IMediaFileStore;
  readFile?: (filePath: string) => Promise<Buffer>;
}

/**
 * Logo da marca d'água no media store. Molde: `StorefrontMediaStore`. Lido a cada envio, sem
 * cache em memória (ajuste novo vale no envio seguinte).
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

  async save(png: Buffer): Promise<string> {
    const key = `offer-watermark-${randomUUID()}.png`;
    await this.deps.files().saveBuffer(png, key);
    return key;
  }

  /**
   * Como `StorefrontMediaStore.remove`: store local exige caminho (`resolveLocalPath`, @deprecated,
   * exceção consciente para não baixar o arquivo só para apagá-lo), o remoto aceita a URL.
   */
  async remove(imageKey: string): Promise<boolean> {
    if (!OFFER_WATERMARK_LOGO_KEY.test(imageKey)) return true;
    const files = this.deps.files();
    const url = files.publicUrl(imageKey);
    try {
      await files.remove(files.resolveLocalPath(url) ?? url);
      return true;
    } catch (err) {
      logger.warn({ err }, 'offer watermark logo remove failed');
      return false;
    }
  }

  publicUrl(imageKey: string): string | null {
    return OFFER_WATERMARK_LOGO_KEY.test(imageKey) ? this.deps.files().publicUrl(imageKey) : null;
  }
}
