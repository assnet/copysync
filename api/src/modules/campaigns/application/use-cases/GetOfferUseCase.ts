import type { IOfferRepository } from '../../domain/contracts/IOfferRepository';
import type { IOfferDispatchRepository } from '../../domain/contracts/IOfferDispatchRepository';
import { OfferNotFoundError } from '../../../../shared/errors/internal/OfferErrors';
import { toOfferDto, type OfferDTO } from '../dtos/OfferDTO';

/** Oferta + envios (polling do painel enquanto SENDING). */
export class GetOfferUseCase {
  constructor(
    private readonly offers: IOfferRepository,
    private readonly dispatches: IOfferDispatchRepository,
  ) {}

  async execute(input: { tenantId: string; offerId: string }): Promise<OfferDTO> {
    const { tenantId, offerId } = input;
    const offer = await this.offers.findById(offerId, tenantId);
    if (!offer) throw new OfferNotFoundError(offerId);
    return toOfferDto(offer, await this.dispatches.listByOffer(offerId, tenantId));
  }
}
