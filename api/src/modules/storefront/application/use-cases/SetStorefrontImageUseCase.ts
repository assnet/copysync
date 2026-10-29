import { STOREFRONT_IMAGE_PRESETS } from '../../domain/services/storefrontRules';
import {
  MediaTooLargeError,
  UploadIncompleteError,
  UploadInProgressError,
  UploadNotFoundError,
} from '../../../../shared/errors/internal/MediaErrors';
import { logger } from '../../../../shared/logger/logger';
import { requireStorefront, requireStorefrontEnabled, type StorefrontUseCaseDeps } from './storefrontUseCaseDeps';

type Deps = Pick<StorefrontUseCaseDeps, 'storefronts' | 'entitlements' | 'images' | 'media' | 'uploads' | 'readFile'>;

export type StorefrontPageImageKind = 'avatar' | 'cover';

export interface SetStorefrontImageInput {
  tenantId: string;
  userId: string;
  kind: StorefrontPageImageKind;
  uploadId: string;
}

const FIELD = { avatar: 'avatarUrl', cover: 'coverUrl' } as const;

/**
 * Foto/capa da página a partir de um upload em partes. Chama o store de upload direto (não
 * `consumeUploadedImage`, que grava o arquivo cru): só o WebP redimensionado vai ao storage.
 * Ordem: gate → página → `beginConsume` (só `started` segue) → tamanho → lê → processa → grava →
 * página → `discard`. Erro antes de gravar libera o upload; o arquivo anterior é apagado no fim.
 */
export class SetStorefrontImageUseCase {
  constructor(private readonly deps: Deps) {}

  async execute(input: SetStorefrontImageInput): Promise<{ url: string }> {
    const { storefronts, entitlements, images, media, uploads } = this.deps;
    const { tenantId, userId, kind, uploadId } = input;

    await requireStorefrontEnabled(entitlements, tenantId);
    const page = await requireStorefront(storefronts, tenantId);

    const begun = await uploads.beginConsume(uploadId, tenantId, userId);
    // Já consumido = virou mensagem/outra imagem: não reaproveita (sem discard, como o gerador)
    if (begun.outcome === 'consumed' || begun.outcome === 'not_found') throw new UploadNotFoundError(undefined, { uploadId });
    if (begun.outcome === 'in_progress') throw new UploadInProgressError(undefined, { uploadId });
    if (begun.outcome === 'incomplete') throw new UploadIncompleteError(undefined, { uploadId });

    let url: string;
    try {
      const { maxInputBytes } = STOREFRONT_IMAGE_PRESETS[kind];
      if (begun.record.sizeBytes > maxInputBytes) throw new MediaTooLargeError(undefined, { uploadId, maxBytes: maxInputBytes });
      const binPath = uploads.binPath(uploadId);
      if (!binPath) throw new UploadNotFoundError(undefined, { uploadId });
      const raw = await this.deps.readFile(binPath);
      if (raw.length > maxInputBytes) throw new MediaTooLargeError(undefined, { uploadId, maxBytes: maxInputBytes });
      const processed = await images.process(raw, kind);
      url = await media.save(processed.buffer);
    } catch (err) {
      await quietly('storefront upload release failed', uploadId, () => uploads.releaseConsume(uploadId));
      throw err;
    }

    // Já está no storage: falha ao descartar só deixa o .bin para a varredura (TTL)
    await quietly('storefront upload discard failed', uploadId, () => uploads.discard(uploadId));

    try {
      await storefronts.update(tenantId, { [FIELD[kind]]: url });
    } catch (err) {
      await media.remove(url);
      throw err;
    }
    const previous = page[FIELD[kind]];
    if (previous) await media.remove(previous);
    return { url };
  }
}

async function quietly(msg: string, uploadId: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.warn({ err, uploadId }, msg);
  }
}
