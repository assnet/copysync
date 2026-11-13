import type { IOfferHuntFindRepository } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { IEntitlementReader } from '../../../domain/contracts/IEntitlementReader';
import type { OfferHuntFind, OfferHuntFindDelivery } from '../../../domain/hunter/OfferHunt';
import { HUNTER_LIMITS } from '../../../domain/services/hunter/hunterLimits';
import { startOfDayInZone } from '../../../domain/services/startOfDayInZone';
import { LANE_TIMEOUT_HOLD_SECONDS } from '../../../domain/offerTyping';
import type { HuntFindDelivery } from '../../services/hunter/HuntFindDelivery';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { PlanFeatureUnavailableError } from '../../../../../shared/errors/internal/PlanErrors';
import {
  OfferHuntNotFoundError, OfferHuntResendDailyLimitError, OfferHuntResendNotDeliveredError, OfferHuntResendPendingError,
} from '../../../../../shared/errors/internal/OfferHuntErrors';
import { logger } from '../../../../../shared/logger/logger';

/** Dois reenvios do mesmo achado dentro disto = clique duplo/2 abas: o 2º é recusado. */
export const HUNT_FIND_RESEND_COOLDOWN_MS = 60_000;
/** Reenvio em voo (Resolve + Enqueue): 2º clique recusado. Vencido sem trocar a oferta = retomável, mesmo número. */
export const HUNT_FIND_RESEND_IN_FLIGHT_MS = 120_000;
/** Tentativas de gravar a oferta nova (a oferta já está na fila). */
const RECORD_ATTEMPTS = 3;

export interface ResendHuntFindDeps {
  finds: Pick<IOfferHuntFindRepository, 'findById' | 'claimResend' | 'releaseResend' | 'recordResend'>;
  entitlements: IEntitlementReader;
  delivery: Pick<HuntFindDelivery, 'resend' | 'requireDestination'>;
  now?: () => Date;
}

/** Disparo anterior ainda pode estar saindo: na fila, enviando ou SEND_TIMEOUT dentro do hold da faixa. */
function previousSendPending(d: OfferHuntFindDelivery | null, now: Date): boolean {
  if (!d) return false;
  if (d.dispatchStatus === 'QUEUED' || d.dispatchStatus === 'SENDING') return true;
  return d.dispatchStatus === 'FAILED' && d.failureReason === 'SEND_TIMEOUT'
    && now.getTime() < d.updatedAt.getTime() + LANE_TIMEOUT_HOLD_SECONDS * 1000;
}

/**
 * "Reenviar" um achado que já teve oferta: link do tenant regerado, preço/foto atuais, destino ATUAL e
 * `sourceKey` `hunt:<id>:r<n>` (`n` = número do reenvio dado pelo claim). Portões: plano Shein e caçador aqui;
 * credencial e aceite `OFFER_HUNTER` no Resolve. Não é achado novo: não conta no teto do dia nem na guarda de
 * 24 execuções; conta no teto de reenvios (`HUNTER_LIMITS.resendsPerDayMax`, 429 `OFFER_HUNT_RESEND_DAILY_LIMIT`).
 * Sem oferta → 409 `OFFER_HUNT_RESEND_NOT_DELIVERED`; disparo anterior QUEUED/SENDING/SEND_TIMEOUT recente,
 * reenvio em voo ou há < 60 s → 409 `OFFER_HUNT_RESEND_PENDING`; outro tenant → 404.
 * Falha antes de trocar a oferta: o próximo clique retoma o MESMO número (Enqueue idempotente, sem duplicar).
 */
export class ResendHuntFindUseCase {
  constructor(private readonly deps: ResendHuntFindDeps) {}

  async execute(input: { tenantId: string; findId: string }): Promise<OfferHuntFind> {
    const { tenantId, findId } = input;
    const { entitlements, finds, delivery } = this.deps;
    for (const key of [ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED, ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]) {
      if ((await entitlements.getBoolean(tenantId, key)) !== true) throw new PlanFeatureUnavailableError(key);
    }
    const find = await finds.findById(tenantId, findId);
    if (!find) throw new OfferHuntNotFoundError('find');
    if (!find.offerId) throw new OfferHuntResendNotDeliveredError(find.status);
    const now = this.deps.now?.() ?? new Date();
    if (previousSendPending(find.delivery, now)) throw new OfferHuntResendPendingError();
    const destination = await delivery.requireDestination(tenantId);
    const claim = await finds.claimResend(tenantId, findId, find.offerId, now, {
      cooldownMs: HUNT_FIND_RESEND_COOLDOWN_MS,
      inFlightMs: HUNT_FIND_RESEND_IN_FLIGHT_MS,
      dayStart: startOfDayInZone(now),
      dailyMax: HUNTER_LIMITS.resendsPerDayMax,
    });
    if (claim.kind === 'PENDING') throw new OfferHuntResendPendingError();
    if (claim.kind === 'DAILY_LIMIT') throw new OfferHuntResendDailyLimitError(HUNTER_LIMITS.resendsPerDayMax);
    let offerId: string;
    try {
      offerId = await delivery.resend(tenantId, find, destination, claim.number);
    } catch (err) {
      await finds.releaseResend(tenantId, findId, claim.number, now).catch(() => undefined);
      throw err;
    }
    await this.record(tenantId, findId, offerId, claim.number);
    logger.info({ tenantId, findId, offerId, resend: claim.number }, 'offer hunt find resent');
    return (await finds.findById(tenantId, findId))
      ?? { ...find, offerId, status: 'SENT', resendCount: claim.number, lastResentAt: now, resendInFlightUntil: null };
  }

  /** Oferta já na fila: grava com retry curto. Esgotado, o em voo vence e o próximo clique reusa a mesma oferta. */
  private async record(tenantId: string, findId: string, offerId: string, number: number): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.deps.finds.recordResend(tenantId, findId, offerId, number);
        return;
      } catch (err) {
        if (attempt >= RECORD_ATTEMPTS) {
          logger.warn({ tenantId, findId, offerId }, 'offer hunt find resend queued; offer not recorded');
          throw err;
        }
        await new Promise((r) => setTimeout(r, 50 * attempt));
      }
    }
  }
}
