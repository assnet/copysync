import type { IOfferRepository } from '../../domain/contracts/IOfferRepository';
import type { IOfferDispatchRepository } from '../../domain/contracts/IOfferDispatchRepository';
import type { IOfferGeneratorConfigRepository } from '../../domain/contracts/IOfferGeneratorConfigRepository';
import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import { scheduleDispatches } from '../../domain/services/scheduleDispatches';
import { appendToLanes, laneGapMs, laneTailsFromOpen } from '../../domain/services/appendToLanes';
import { orderDispatchTargets } from '../../domain/services/orderDispatchTargets';
import { fitSlots } from '../../domain/services/fitSlots';
import { resolveStartWithinPostingWindow } from '../../domain/services/postingWindow';
import { dispatchStartAt } from '../../domain/offerSchedule';
import type { Offer } from '../../domain/entities/Offer';
import type { OfferGeneratorConfig } from '../../domain/entities/OfferGeneratorConfig';
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
import { CROSS_SESSION_DISPATCH } from './OfferGeneratorConfigUseCases';
import { countByChannel, keepOneSessionPerChannel, LIMIT_CHANNELS, limitKeyOfChannel, requiresCrossSession } from '../../../tenants/domain/channelLimits';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';

export const MENTION_ALL_ENABLED = ENTITLEMENT_KEYS.MENTION_ALL_ENABLED;

/**
 * Envios do gerador sem `scheduledAt` encaixam na janela de postagem da configuração (PS-05), igual
 * ao claim do worker (D3: horário agendado explícito ignora a janela). Sem configuração ou janela
 * padrão (dia inteiro, todos os dias) os horários não mudam.
 */
export function fitToGeneratorWindow(
  slots: Date[],
  offer: Pick<Offer, 'origin' | 'scheduledAt'>,
  config: Pick<OfferGeneratorConfig, 'windowStartMinute' | 'windowEndMinute' | 'weekdaysMask'> | null,
): Date[] {
  if (!config || offer.origin !== 'GENERATOR' || offer.scheduledAt) return slots;
  const window = { startMinute: config.windowStartMinute, endMinute: config.windowEndMinute, weekdaysMask: config.weekdaysMask };
  return fitSlots(slots, (at) => resolveStartWithinPostingWindow(at, window));
}

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
 * intervalo da configuração a partir do início agendado (ou agora), DRAFT → SENDING atômico + um envio por grupo. Quem envia é o worker.
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
    if (!config || config.sessionIds.length === 0) throw new OfferConfigMissingError();
    const sessions = await configs.findSessions(tenantId, config.sessionIds);
    if (sessions.length !== config.sessionIds.length) throw new OfferConfigMissingError();
    // Todas precisam estar conectadas: envio parcial silencioso esconderia grupos sem oferta
    const offline = sessions.find((s) => s.status !== 'CONNECTED');
    if (offline) throw new SessionNotConnectedError(offline.id);

    // Só grupos das sessões configuradas (defesa contra destino antigo de outra sessão). Plano
    // rebaixado depois de salvar 2+ sessões do mesmo canal: só a 1ª de cada canal dispara
    const engineById = new Map(sessions.map((s) => [s.id, s.engine]));
    const crossSession = requiresCrossSession(sessions) && (await entitlements.getBoolean(tenantId, CROSS_SESSION_DISPATCH)) === true;
    const allowedIds = requiresCrossSession(sessions) && !crossSession
      ? keepOneSessionPerChannel(config.sessionIds, (id) => id, (id) => engineById.get(id))
      : config.sessionIds;
    const allowed = new Set(allowedIds);
    const groups = (await configs.listGroups(tenantId))
      .filter((g): g is typeof g & { sessionId: string } => g.isGroup && g.sessionId != null && allowed.has(g.sessionId));
    const targets = orderDispatchTargets(groups, config.sessionIds, config.dispatchOrder);
    if (targets.length === 0) throw new OfferNoDestinationsError();
    // Plano rebaixado depois de salvar a configuração: limite de grupos por canal
    const perChannel = countByChannel(targets, (t) => engineById.get(t.sessionId));
    for (const ch of LIMIT_CHANNELS) {
      if (perChannel[ch] === 0) continue;
      const key = limitKeyOfChannel('broadcastGroups', ch);
      const limit = await entitlements.getNumber(tenantId, key);
      if (limit !== null && perChannel[ch] > limit) throw new PlanLimitReachedError(key, limit);
    }

    const interval = { minMs: config.intervalMinSeconds * 1000, maxMs: config.intervalMaxSeconds * 1000 };
    const planned = scheduleDispatches(
      targets.length,
      // Agendamento vencido (oferta disparada depois do horário) começa agora
      dispatchStartAt(offer.scheduledAt, (this.deps.now ?? (() => new Date()))()),
      interval,
      this.deps.rand,
    );
    // Fila por sessão: a oferta inteira (uma fila só, mesmo com várias sessões) entra depois do que
    // já está à frente em qualquer das suas sessões (docs/fila-de-envio.md)
    // Fim do bloco ocupado de cada sessão: captura do monitoramento agendada para a próxima janela não prende o gerador
    const openBySession = new Map<string, Date[]>();
    for (const sessionId of new Set(targets.map((t) => t.sessionId))) {
      openBySession.set(sessionId, await dispatches.openNotBefore(tenantId, sessionId, planned[0]!));
    }
    const tails = laneTailsFromOpen(openBySession, planned[0]!, interval.maxMs);
    const laned = tails.size === 0
      ? planned
      : appendToLanes(targets.map((t, i) => ({ sessionId: t.sessionId, notBefore: planned[i]! })), tails, laneGapMs(interval, this.deps.rand));
    // Fila mostra o horário real: fora da janela do gerador, cada envio espera a próxima abertura
    const slots = fitToGeneratorWindow(laned, offer, config);
    const items = targets.map((t, i) => ({
      conversationId: t.conversationId,
      sessionId: t.sessionId,
      notBefore: slots[i]!,
      gapSeconds: config.intervalMinSeconds,
    }));

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
