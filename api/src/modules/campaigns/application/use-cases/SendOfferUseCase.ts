import type { IOfferRepository } from '../../domain/contracts/IOfferRepository';
import type { IOfferDispatchRepository } from '../../domain/contracts/IOfferDispatchRepository';
import type { IOfferDestinationRepository } from '../../domain/contracts/IOfferDestinationRepository';
import {
  DEFAULT_DISPATCH_INTERVAL,
  scheduleDispatches,
  type DispatchInterval,
} from '../../domain/services/scheduleDispatches';
import {
  OfferAlreadySentError,
  OfferNoDestinationsError,
  OfferNotFoundError,
} from '../../../../shared/errors/internal/OfferErrors';
import { toOfferDispatchDto, toOfferDto, type OfferDispatchDTO, type OfferDTO } from '../dtos/OfferDTO';

export interface SendOfferInput {
  tenantId: string;
  offerId: string;
}

export interface SendOfferOutput {
  offer: OfferDTO;
  dispatches: OfferDispatchDTO[];
}

export interface SendOfferDeps {
  offers: IOfferRepository;
  dispatches: IOfferDispatchRepository;
  destinations: IOfferDestinationRepository;
  interval?: DispatchInterval;
  now?: () => Date;
  rand?: () => number;
}

/**
 * Enfileira a oferta para os destinos (OFFER-08): DRAFT → SENDING atômico + um envio por
 * destino com `notBefore` espaçado. Quem envia é o worker.
 */
export class SendOfferUseCase {
  constructor(private readonly deps: SendOfferDeps) {}

  async execute(input: SendOfferInput): Promise<SendOfferOutput> {
    const { tenantId, offerId } = input;
    const { offers, dispatches, destinations } = this.deps;

    const offer = await offers.findById(offerId, tenantId);
    if (!offer) throw new OfferNotFoundError(offerId);
    if (offer.status !== 'DRAFT') throw new OfferAlreadySentError(offerId);

    const targets = await destinations.list(tenantId);
    if (targets.length === 0) throw new OfferNoDestinationsError();

    const slots = scheduleDispatches(
      targets.length,
      (this.deps.now ?? (() => new Date()))(),
      this.deps.interval ?? DEFAULT_DISPATCH_INTERVAL,
      this.deps.rand,
    );
    const items = targets.map((t, i) => ({ conversationId: t.conversationId, notBefore: slots[i]! }));

    // Corrida com outro envio/edição: a transição condicional decide
    const created = await dispatches.startSending(offerId, tenantId, items);
    if (!created) throw new OfferAlreadySentError(offerId);

    return {
      offer: toOfferDto({ ...offer, status: 'SENDING' }),
      dispatches: created.map(toOfferDispatchDto),
    };
  }
}
