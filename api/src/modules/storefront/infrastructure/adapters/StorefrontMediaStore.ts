import { randomUUID } from 'crypto';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import { logger } from '../../../../shared/logger/logger';
import type { IStorefrontMediaStore } from '../../domain/contracts/IStorefrontMediaStore';

/** Nome que `save` grava; só ele pode ser apagado por `remove` (nunca objeto arbitrário). */
const STOREFRONT_IMAGE_NAME = /(^|\/)storefront-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/i;

export interface StorefrontMediaStoreDeps {
  files: () => IMediaFileStore;
}

/**
 * Foto, capa e imagem de oferta da página no media store (`storefront-<uuid>.webp`), já
 * processadas por `IStorefrontImageProcessor`. Molde: `MediaOfferStore` (campaigns).
 */
export class StorefrontMediaStore implements IStorefrontMediaStore {
  constructor(private readonly deps: StorefrontMediaStoreDeps) {}

  async save(buffer: Buffer): Promise<string> {
    return this.deps.files().saveBuffer(buffer, `storefront-${randomUUID()}.webp`);
  }

  /**
   * Store local exige caminho e o remoto aceita a URL (resolve null). `resolveLocalPath` é
   * @deprecated, mas `acquireLocalFile` baixaria o arquivo só para apagá-lo: exceção
   * consciente, mesmo uso de `MediaOfferStore.removeImage`. Falha só é logada.
   */
  async remove(url: string): Promise<void> {
    if (!STOREFRONT_IMAGE_NAME.test(url.split(/[?#]/)[0] ?? '')) return;
    const files = this.deps.files();
    try {
      await files.remove(files.resolveLocalPath(url) ?? url);
    } catch (err) {
      logger.warn({ err }, 'storefront image remove failed');
    }
  }
}
