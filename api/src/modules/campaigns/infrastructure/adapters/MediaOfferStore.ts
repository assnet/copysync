import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import type {
  ConsumeOfferImageUploadInput,
  IOfferMediaStore,
} from '../../domain/contracts/IOfferMediaStore';
import type { IMediaFileStore } from '../../../media/domain/contracts/IMediaFileStore';
import type { IUploadSessionStore } from '../../../media/domain/contracts/IUploadSessionStore';
import { sniffMediaType } from '../../../media/domain/services/sniffMediaType';
import {
  MediaTooLargeError,
  UnsupportedMediaTypeError,
  UploadIncompleteError,
  UploadInProgressError,
  UploadNotFoundError,
} from '../../../../shared/errors/internal/MediaErrors';
import { logger } from '../../../../shared/logger/logger';
import { OFFER_IMAGE_EXT, OFFER_IMAGE_MAX_BYTES } from './offerImageTypes';

const SNIFF_BYTES = 4096;
/** Nome que `saveImage` grava; só ele pode ser apagado por `removeImage`. */
const OFFER_IMAGE_NAME = /\/offer-[0-9a-f-]{36}\.(jpg|png|webp)$/i;

export interface MediaOfferStoreDeps {
  files: () => IMediaFileStore;
  uploads: () => IUploadSessionStore;
  readFile?: (filePath: string) => Promise<Buffer>;
}

/**
 * Foto da oferta no media store (`offer-<uuid>.<ext>`). A origem nunca é movida: cada envio
 * copia (ver `SendStoredMediaMessageUseCase`).
 *
 * Upload do operador: não vira mensagem, então não há `messageId` para o `finishConsume`.
 * Depois de salvar no store o upload é descartado (`discard`); erro de validação devolve o
 * upload a `OPEN` (`releaseConsume`), como o envio de mídia do chat.
 */
export class MediaOfferStore implements IOfferMediaStore {
  constructor(private readonly deps: MediaOfferStoreDeps) {}

  async saveImage(buffer: Buffer, mimeType: string): Promise<string> {
    const ext = OFFER_IMAGE_EXT[mimeType.toLowerCase()];
    if (!ext) throw new UnsupportedMediaTypeError('Only JPEG, PNG or WebP images are accepted');
    if (buffer.length > OFFER_IMAGE_MAX_BYTES) throw new MediaTooLargeError();
    return this.deps.files().saveBuffer(buffer, `offer-${randomUUID()}.${ext}`);
  }

  /** Store local exige caminho (`resolveLocalPath`); o remoto aceita a URL (resolve null). */
  async removeImage(url: string): Promise<void> {
    if (!OFFER_IMAGE_NAME.test(url.split(/[?#]/)[0] ?? '')) return;
    const files = this.deps.files();
    try {
      await files.remove(files.resolveLocalPath(url) ?? url);
    } catch (err) {
      logger.warn({ err }, 'offer image remove failed');
    }
  }

  async consumeUploadedImage(input: ConsumeOfferImageUploadInput): Promise<string> {
    const { tenantId, userId, uploadId } = input;
    const uploads = this.deps.uploads();

    const begun = await uploads.beginConsume(uploadId, tenantId, userId);
    // Já consumido = virou mensagem de chat (ou outra oferta): não reaproveita.
    if (begun.outcome === 'consumed' || begun.outcome === 'not_found') {
      throw new UploadNotFoundError(undefined, { uploadId });
    }
    if (begun.outcome === 'in_progress') throw new UploadInProgressError(undefined, { uploadId });
    if (begun.outcome === 'incomplete') throw new UploadIncompleteError(undefined, { uploadId });

    let buffer: Buffer;
    let mimeType: string;
    try {
      if (begun.record.sizeBytes > OFFER_IMAGE_MAX_BYTES) {
        throw new MediaTooLargeError(undefined, { uploadId });
      }
      const head = await uploads.readHead(uploadId, SNIFF_BYTES);
      const binPath = uploads.binPath(uploadId);
      if (!head || !binPath) throw new UploadNotFoundError(undefined, { uploadId });

      mimeType = sniffMediaType(head, begun.record.declaredMimeType).mimeType;
      if (!OFFER_IMAGE_EXT[mimeType]) {
        throw new UnsupportedMediaTypeError('Only JPEG, PNG or WebP images are accepted', { uploadId });
      }

      buffer = await (this.deps.readFile ?? fs.readFile)(binPath);
      if (buffer.length > OFFER_IMAGE_MAX_BYTES) throw new MediaTooLargeError(undefined, { uploadId });
    } catch (err) {
      await this.quietly('offer upload release failed', uploadId, () => uploads.releaseConsume(uploadId));
      throw err;
    }

    let url: string;
    try {
      url = await this.saveImage(buffer, mimeType);
    } catch (err) {
      await this.quietly('offer upload release failed', uploadId, () => uploads.releaseConsume(uploadId));
      throw err;
    }

    // Já está no store: falha ao descartar só deixa o .bin para a varredura (TTL).
    await this.quietly('offer upload discard failed', uploadId, () => uploads.discard(uploadId));
    return url;
  }

  private async quietly(msg: string, uploadId: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      logger.warn({ err, uploadId }, msg);
    }
  }
}
