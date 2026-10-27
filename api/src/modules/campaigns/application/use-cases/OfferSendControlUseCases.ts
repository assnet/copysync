import type { IOfferRepository } from '../../domain/contracts/IOfferRepository';
import type { IOfferDispatchRepository } from '../../domain/contracts/IOfferDispatchRepository';
import type { IOfferGeneratorConfigRepository } from '../../domain/contracts/IOfferGeneratorConfigRepository';
import { scheduleDispatches } from '../../domain/services/scheduleDispatches';
import { dispatchStartAt } from '../../domain/offerSchedule';
import { OfferInvalidStateError, OfferNotFoundError } from '../../../../shared/errors/internal/OfferErrors';
import { toOfferDto, type OfferDTO } from '../dtos/OfferDTO';
import { DEFAULT_INTERVAL } from './OfferGeneratorConfigUseCases';

export interface OfferControlInput {
  tenantId: string;
  offerId: string;
}

export interface OfferControlDeps {
  offers: IOfferRepository;
  dispatches: IOfferDispatchRepository;
  configs: IOfferGeneratorConfigRepository;
  now?: () => Date;
  rand?: () => number;
}

/**
 * Controles do envio em andamento. Todos devolvem a oferta com os envios (estado que o painel
 * mostra). Envio que já está SENDING no worker sempre termina: pausar/parar só segura a fila.
 */
abstract class OfferControlUseCase {
  constructor(protected readonly deps: OfferControlDeps) {}

  protected async load(input: OfferControlInput) {
    const offer = await this.deps.offers.findById(input.offerId, input.tenantId);
    if (!offer) throw new OfferNotFoundError(input.offerId);
    return offer;
  }

  protected async result(input: OfferControlInput): Promise<OfferDTO> {
    const offer = await this.load(input);
    return toOfferDto(offer, await this.deps.dispatches.listByOffer(input.offerId, input.tenantId));
  }
}

/** SENDING → PAUSED. O worker deixa de reivindicar os QUEUED desta oferta. */
export class PauseOfferUseCase extends OfferControlUseCase {
  async execute(input: OfferControlInput): Promise<OfferDTO> {
    const offer = await this.load(input);
    if (!(await this.deps.offers.transitionStatus(offer.id, input.tenantId, ['SENDING'], 'PAUSED'))) {
      throw new OfferInvalidStateError(offer.id, offer.status);
    }
    return this.result(input);
  }
}

/**
 * PAUSED → SENDING. Os QUEUED são reagendados a partir de agora (ou do início agendado, se
 * ainda não chegou) com o intervalo da
 * configuração atual, na mesma ordem: nada sai em rajada por causa do tempo parado.
 */
export class ResumeOfferUseCase extends OfferControlUseCase {
  async execute(input: OfferControlInput): Promise<OfferDTO> {
    const offer = await this.load(input);
    if (offer.status !== 'PAUSED') throw new OfferInvalidStateError(offer.id, offer.status);

    const config = await this.deps.configs.find(input.tenantId);
    const interval = {
      minMs: (config?.intervalMinSeconds ?? DEFAULT_INTERVAL.min) * 1000,
      maxMs: (config?.intervalMaxSeconds ?? DEFAULT_INTERVAL.max) * 1000,
    };
    const queued = (await this.deps.dispatches.listByOffer(offer.id, input.tenantId)).filter((d) => d.status === 'QUEUED').length;
    // Pausada antes do início agendado: retomar mantém o horário marcado
    const start = dispatchStartAt(offer.scheduledAt, (this.deps.now ?? (() => new Date()))());
    const slots = scheduleDispatches(queued, start, interval, this.deps.rand);
    await this.deps.dispatches.rescheduleQueued(offer.id, input.tenantId, slots);

    if (!(await this.deps.offers.transitionStatus(offer.id, input.tenantId, ['PAUSED'], 'SENDING'))) {
      throw new OfferInvalidStateError(offer.id, offer.status);
    }
    return this.result(input);
  }
}

/** SENDING | PAUSED → CANCELLED; QUEUED → CANCELLED. Final: oferta parada não retoma (gere outra). */
export class CancelOfferUseCase extends OfferControlUseCase {
  async execute(input: OfferControlInput): Promise<OfferDTO> {
    const offer = await this.load(input);
    if (!(await this.deps.offers.transitionStatus(offer.id, input.tenantId, ['SENDING', 'PAUSED'], 'CANCELLED'))) {
      throw new OfferInvalidStateError(offer.id, offer.status);
    }
    await this.deps.dispatches.cancelQueued(offer.id, input.tenantId);
    return this.result(input);
  }
}
