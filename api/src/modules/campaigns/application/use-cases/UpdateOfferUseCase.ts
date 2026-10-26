import type { IOfferRepository, OfferPatch, UpdateOfferResult } from '../../domain/contracts/IOfferRepository';
import { EDITABLE_OFFER_STATUSES } from '../../domain/contracts/IOfferRepository';
import type { IOfferMediaStore } from '../../domain/contracts/IOfferMediaStore';
import { renderOfferText } from '../../domain/services/renderOfferText';
import { OFFER_AUDIENCES, type OfferAudience } from '../../domain/enums/OfferAudience';
import { normalizeCoupon } from './offerCoupon';
import {
  OfferAlreadySentError,
  OfferInvalidInputError,
  OfferNotFoundError,
} from '../../../../shared/errors/internal/OfferErrors';
import { logger } from '../../../../shared/logger/logger';
import { toOfferDto, type OfferDTO } from '../dtos/OfferDTO';

export const OFFER_TEXT_MAX = 4096;
export const OFFER_TITLE_MAX = 300;

export interface UpdateOfferInput {
  tenantId: string;
  userId: string;
  offerId: string;
  /** null limpa o campo. */
  title?: string | null;
  priceCents?: number | null;
  originalPriceCents?: number | null;
  text?: string;
  imageUploadId?: string;
  /** null/vazio remove o cupom. */
  coupon?: string | null;
  audience?: OfferAudience;
  mentionAll?: boolean;
}

export interface UpdateOfferDeps {
  offers: IOfferRepository;
  mediaStore: IOfferMediaStore;
}

/**
 * Edição antes do envio (OFFER-06). Texto enviado = editado à mão; sem texto, o modelo
 * remonta enquanto o operador não tiver editado o texto.
 */
export class UpdateOfferUseCase {
  constructor(private readonly deps: UpdateOfferDeps) {}

  async execute(input: UpdateOfferInput): Promise<OfferDTO> {
    const { tenantId, offerId } = input;
    validate(input);

    const offer = await this.deps.offers.findById(offerId, tenantId);
    if (!offer) throw new OfferNotFoundError(offerId);
    // Antes de consumir o upload: oferta enviada não gasta o arquivo
    if (!EDITABLE_OFFER_STATUSES.includes(offer.status)) throw new OfferAlreadySentError(offerId);

    const patch: OfferPatch = {};
    if (input.title !== undefined) patch.title = input.title?.trim() || null;
    if (input.priceCents !== undefined) patch.priceCents = input.priceCents;
    if (input.originalPriceCents !== undefined) patch.originalPriceCents = input.originalPriceCents;
    if (input.coupon !== undefined) patch.coupon = normalizeCoupon(input.coupon);
    if (input.audience !== undefined) patch.audience = input.audience;
    if (input.mentionAll !== undefined) patch.mentionAll = input.mentionAll;

    if (input.imageUploadId) {
      patch.imageUrl = await this.deps.mediaStore.consumeUploadedImage({
        tenantId,
        userId: input.userId,
        uploadId: input.imageUploadId,
      });
    }

    if (input.text !== undefined) {
      patch.text = input.text;
      patch.textEdited = true;
    } else if (!offer.textEdited && (patch.audience ?? offer.audience) === 'STANDARD' && changesTextData(offer, patch)) {
      // Só o modelo fixo remonta sozinho; texto de IA muda por "Gerar novamente"
      patch.text = renderOfferText({
        title: patch.title !== undefined ? patch.title : offer.title,
        priceCents: patch.priceCents !== undefined ? patch.priceCents : offer.priceCents,
        originalPriceCents:
          patch.originalPriceCents !== undefined ? patch.originalPriceCents : offer.originalPriceCents,
        affiliateUrl: offer.affiliateUrl,
        coupon: patch.coupon !== undefined ? patch.coupon : offer.coupon,
      });
    }

    const newImage = patch.imageUrl ?? null;
    const previousImage = offer.imageUrl;
    let result: UpdateOfferResult;
    try {
      result = await this.deps.offers.update(offerId, tenantId, patch);
    } catch (err) {
      await this.discardImage(newImage);
      throw err;
    }
    if (result.outcome !== 'updated') {
      // Foto nova não chegou à oferta: não deixa órfã no store
      await this.discardImage(newImage);
      if (result.outcome === 'not_found') throw new OfferNotFoundError(offerId);
      throw new OfferAlreadySentError(offerId);
    }
    // Foto trocada: a anterior não é mais referenciada (cada envio usa cópia própria)
    if (newImage && previousImage && previousImage !== newImage) await this.discardImage(previousImage);
    return toOfferDto(result.offer);
  }

  /** Melhor esforço: falha só deixa arquivo órfão, nunca troca o resultado. */
  private async discardImage(url: string | null): Promise<void> {
    if (!url) return;
    try {
      await this.deps.mediaStore.removeImage(url);
    } catch (err) {
      logger.warn({ err: (err as Error)?.name }, 'offer image discard failed');
    }
  }
}

function changesTextData(
  offer: {
    title: string | null;
    priceCents: number | null;
    originalPriceCents: number | null;
    coupon: string | null;
    audience: OfferAudience;
  },
  patch: OfferPatch,
): boolean {
  return (
    (patch.coupon !== undefined && patch.coupon !== offer.coupon) ||
    (patch.audience !== undefined && patch.audience !== offer.audience) ||
    (patch.title !== undefined && patch.title !== offer.title) ||
    (patch.priceCents !== undefined && patch.priceCents !== offer.priceCents) ||
    (patch.originalPriceCents !== undefined && patch.originalPriceCents !== offer.originalPriceCents)
  );
}

function validate(input: UpdateOfferInput): void {
  if (input.audience !== undefined && !OFFER_AUDIENCES.includes(input.audience)) {
    throw new OfferInvalidInputError('Unknown audience', 'audience');
  }
  if (input.coupon !== undefined) normalizeCoupon(input.coupon);
  if (input.title != null && input.title.length > OFFER_TITLE_MAX) {
    throw new OfferInvalidInputError(`Title exceeds ${OFFER_TITLE_MAX} characters`, 'title');
  }
  for (const field of ['priceCents', 'originalPriceCents'] as const) {
    const v = input[field];
    if (v != null && (!Number.isSafeInteger(v) || v < 0)) {
      throw new OfferInvalidInputError('Price must be a non-negative integer (cents)', field);
    }
  }
  if (input.text !== undefined) {
    if (input.text.trim() === '') throw new OfferInvalidInputError('Text is empty', 'text');
    if (input.text.length > OFFER_TEXT_MAX) {
      throw new OfferInvalidInputError(`Text exceeds ${OFFER_TEXT_MAX} characters`, 'text');
    }
  }
}
