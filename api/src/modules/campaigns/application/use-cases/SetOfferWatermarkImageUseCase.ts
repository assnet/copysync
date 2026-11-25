import { OFFER_WATERMARK_LOGO_MAX_BYTES } from '../../domain/services/offerWatermarkRules';
import {
  MediaTooLargeError,
  UploadIncompleteError,
  UploadInProgressError,
  UploadNotFoundError,
} from '../../../../shared/errors/internal/MediaErrors';
import { logger } from '../../../../shared/logger/logger';
import {
  requireOfferWatermarkEditor,
  requireOfferWatermarkPlan,
  toOfferWatermarkView,
  type OfferWatermarkActor,
  type OfferWatermarkUseCaseDeps,
  type OfferWatermarkView,
} from './offerWatermarkUseCaseDeps';

/**
 * Logo da marca a partir de um upload em partes (spec IMG-06). Sequência de `SetStorefrontImageUseCase`:
 * plano → papel → `beginConsume` (só `started` segue) → tamanho → lê → valida/normaliza → grava →
 * `discard` → registro. Erro antes de gravar libera o upload; registro que falha apaga o logo novo;
 * o logo anterior só é apagado do storage no fim (o registro nunca aponta para arquivo sumido).
 */
export class SetOfferWatermarkImageUseCase {
  constructor(private readonly deps: OfferWatermarkUseCaseDeps) {}

  async execute(actor: OfferWatermarkActor, uploadId: string): Promise<OfferWatermarkView> {
    const { watermarks, entitlements, logos, processor, uploads } = this.deps;
    const { tenantId, userId } = actor;

    await requireOfferWatermarkPlan(entitlements, tenantId);
    requireOfferWatermarkEditor(actor);
    const previous = (await watermarks.findByTenant(tenantId))?.imageKey ?? null;

    const begun = await uploads.beginConsume(uploadId, tenantId, userId);
    // Já consumido = virou mensagem/outra imagem: não reaproveita (sem discard, como o storefront)
    if (begun.outcome === 'consumed' || begun.outcome === 'not_found') throw new UploadNotFoundError(undefined, { uploadId });
    if (begun.outcome === 'in_progress') throw new UploadInProgressError(undefined, { uploadId });
    if (begun.outcome === 'incomplete') throw new UploadIncompleteError(undefined, { uploadId });

    let key: string;
    try {
      const maxBytes = OFFER_WATERMARK_LOGO_MAX_BYTES;
      if (begun.record.sizeBytes > maxBytes) throw new MediaTooLargeError(undefined, { uploadId, maxBytes });
      const binPath = uploads.binPath(uploadId);
      if (!binPath) throw new UploadNotFoundError(undefined, { uploadId });
      const raw = await this.deps.readFile(binPath);
      if (raw.length > maxBytes) throw new MediaTooLargeError(undefined, { uploadId, maxBytes });
      const logo = await processor.normalize(raw);
      key = await logos.save(logo.buffer);
    } catch (err) {
      await quietly('offer watermark upload release failed', uploadId, () => uploads.releaseConsume(uploadId));
      throw err;
    }

    // Já está no storage: falha ao descartar só deixa o .bin para a varredura (TTL)
    await quietly('offer watermark upload discard failed', uploadId, () => uploads.discard(uploadId));

    let saved;
    try {
      saved = await watermarks.save(tenantId, { imageKey: key });
    } catch (err) {
      await logos.remove(key);
      throw err;
    }
    if (previous && previous !== key) await logos.remove(previous);
    return toOfferWatermarkView(saved, logos, actor);
  }
}

async function quietly(msg: string, uploadId: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.warn({ err, uploadId }, msg);
  }
}
