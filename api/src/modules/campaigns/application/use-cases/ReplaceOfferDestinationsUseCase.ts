import type { IOfferDestinationRepository } from '../../domain/contracts/IOfferDestinationRepository';
import type { OfferDestinationView } from '../../domain/entities/OfferDestination';
import { OfferInvalidInputError } from '../../../../shared/errors/internal/OfferErrors';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';

export const OFFER_DESTINATIONS_MAX = 200;

export interface ReplaceOfferDestinationsInput {
  tenantId: string;
  conversationIds: string[];
}

/** Substitui o conjunto (OFFER-07). Todo id precisa ser conversa do tenant, senão nada muda. */
export class ReplaceOfferDestinationsUseCase {
  constructor(private readonly destinations: IOfferDestinationRepository) {}

  async execute(input: ReplaceOfferDestinationsInput): Promise<OfferDestinationView[]> {
    const { tenantId } = input;
    const ids = [...new Set(input.conversationIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length > OFFER_DESTINATIONS_MAX) {
      throw new OfferInvalidInputError(`At most ${OFFER_DESTINATIONS_MAX} destinations`, 'conversationIds');
    }

    if (ids.length > 0) {
      const owned = new Set(await this.destinations.filterOwnedConversations(tenantId, ids));
      const missing = ids.filter((id) => !owned.has(id)).length;
      if (missing > 0) throw new NotFoundError('Conversation', `${missing} of ${ids.length}`);
    }

    await this.destinations.replace(tenantId, ids);
    return this.destinations.list(tenantId);
  }
}
