import type { IOfferRepository } from '../../domain/contracts/IOfferRepository';
import type { IOfferDispatchRepository } from '../../domain/contracts/IOfferDispatchRepository';
import type { IOfferGeneratorConfigRepository } from '../../domain/contracts/IOfferGeneratorConfigRepository';
import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import { scheduleDispatches } from '../../domain/services/scheduleDispatches';
import {
  OfferAlreadySentError,
  OfferChangedError,
  OfferConfigMissingError,
  OfferMentionAllUnavailableError,
  OfferNoDestinationsError,
  OfferNotFoundError,
} from '../../../../shared/errors/internal/OfferErrors';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';
import { SessionNotConnectedError } from '../../../../shared/errors/internal/SessionErrors';
import { toOfferDispatchDto, toOfferDto, type OfferDispatchDTO, type OfferDTO } from '../dtos/OfferDTO';
import { BROADCAST_GROUPS } from './OfferGeneratorConfigUseCases';

export const MENTION_ALL_ENABLED = 'mention_all_enabled';

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
  configs: IOfferGeneratorConfigRepository;
  entitlements: IEntitlementReader;
  now?: () => Date;
  rand?: () => number;
}

/**
 * Enfileira a oferta para os grupos da configuração (GEN-05): snapshot dos grupos agora,
 * intervalo da configuração, DRAFT → SENDING atômico + um envio por grupo. Quem envia é o worker.
 */
export class SendOfferUseCase {
  constructor(private readonly deps: SendOfferDeps) {}

  async execute(input: SendOfferInput): Promise<SendOfferOutput> {
    const { tenantId, offerId } = input;
    const { offers, dispatches, configs, entitlements } = this.deps;

    const offer = await offers.findById(offerId, tenantId);
    if (!offer) throw new OfferNotFoundError(offerId);
    if (offer.status !== 'DRAFT') throw new OfferAlreadySentError(offerId);

    // Ausente = permitido; só `false` explícito bloqueia
    if (offer.mentionAll && (await entitlements.getBoolean(tenantId, MENTION_ALL_ENABLED)) === false) {
      throw new OfferMentionAllUnavailableError();
    }

    const config = await configs.find(tenantId);
    if (!config?.sessionId) throw new OfferConfigMissingError();
    const session = await configs.findSession(tenantId, config.sessionId);
    if (!session) throw new OfferConfigMissingError();
    if (session.status !== 'CONNECTED') throw new SessionNotConnectedError(session.id);

    // Só grupos da sessão configurada (defesa contra destino antigo de outra sessão)
    const targets = (await configs.listGroups(tenantId)).filter((g) => g.isGroup && g.sessionId === session.id);
    if (targets.length === 0) throw new OfferNoDestinationsError();
    // Plano rebaixado depois de salvar a configuração
    const limit = await entitlements.getNumber(tenantId, BROADCAST_GROUPS);
    if (limit !== null && targets.length > limit) throw new PlanLimitReachedError(BROADCAST_GROUPS, limit);

    const slots = scheduleDispatches(
      targets.length,
      (this.deps.now ?? (() => new Date()))(),
      { minMs: config.intervalMinSeconds * 1000, maxMs: config.intervalMaxSeconds * 1000 },
      this.deps.rand,
    );
    const items = targets.map((t, i) => ({ conversationId: t.conversationId, notBefore: slots[i]! }));

    // Corrida com outro envio/edição: a transição condicional (DRAFT + mentionAll validado) decide
    const created = await dispatches.startSending(offerId, tenantId, { mentionAll: offer.mentionAll }, items);
    if (!created) {
      const current = await offers.findById(offerId, tenantId);
      if (current?.status === 'DRAFT') throw new OfferChangedError(offerId);
      throw new OfferAlreadySentError(offerId);
    }

    return {
      offer: toOfferDto({ ...offer, status: 'SENDING' }),
      dispatches: created.map(toOfferDispatchDto),
    };
  }
}
