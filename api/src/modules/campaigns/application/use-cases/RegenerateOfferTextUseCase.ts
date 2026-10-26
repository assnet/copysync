import type { IOfferRepository } from '../../domain/contracts/IOfferRepository';
import { EDITABLE_OFFER_STATUSES } from '../../domain/contracts/IOfferRepository';
import { OFFER_AUDIENCES, type OfferAudience } from '../../domain/enums/OfferAudience';
import {
  OfferAlreadySentError,
  OfferChangedError,
  OfferInvalidInputError,
  OfferNotFoundError,
} from '../../../../shared/errors/internal/OfferErrors';
import { toOfferDto, type OfferDTO } from '../dtos/OfferDTO';
import type { OfferTextComposer } from '../services/OfferTextComposer';

export interface RegenerateOfferTextInput {
  tenantId: string;
  offerId: string;
  /** Troca o público antes de gerar; ausente = mantém o da oferta. */
  audience?: OfferAudience;
}

export interface RegenerateOfferTextOutput {
  offer: OfferDTO;
  aiFallback: boolean;
  aiErrorCode?: string;
}

/**
 * "Gerar novamente" (GEN-04): novo texto para a oferta em rascunho. Não conta no limite de
 * ofertas (o de IA é do gerador de texto). Descarta a edição manual: `textEdited = false`.
 */
export class RegenerateOfferTextUseCase {
  constructor(private readonly deps: { offers: IOfferRepository; texts: OfferTextComposer }) {}

  async execute(input: RegenerateOfferTextInput): Promise<RegenerateOfferTextOutput> {
    const { tenantId, offerId } = input;
    if (input.audience !== undefined && !OFFER_AUDIENCES.includes(input.audience)) {
      throw new OfferInvalidInputError('Unknown audience', 'audience');
    }
    const offer = await this.deps.offers.findById(offerId, tenantId);
    if (!offer) throw new OfferNotFoundError(offerId);
    // Antes da IA: oferta enviada não gasta chamada
    if (!EDITABLE_OFFER_STATUSES.includes(offer.status)) throw new OfferAlreadySentError(offerId);

    const audience = input.audience ?? offer.audience;
    const readAt = offer.updatedAt;
    const composed = await this.deps.texts.compose({
      tenantId,
      audience,
      title: offer.title,
      priceCents: offer.priceCents,
      originalPriceCents: offer.originalPriceCents,
      coupon: offer.coupon,
      affiliateUrl: offer.affiliateUrl,
    });

    // Condicional ao `updatedAt` lido antes da IA: edição no meio não é sobrescrita
    const patch = { text: composed.text, textEdited: false, audience };
    const result = await this.deps.offers.update(offerId, tenantId, patch, readAt);
    if (result.outcome === 'not_found') throw new OfferNotFoundError(offerId);
    if (result.outcome === 'not_editable') throw new OfferAlreadySentError(offerId);
    if (result.outcome === 'changed') throw new OfferChangedError(offerId);
    return {
      offer: toOfferDto(result.offer),
      aiFallback: composed.aiFallback,
      ...(composed.aiErrorCode ? { aiErrorCode: composed.aiErrorCode } : {}),
    };
  }
}
