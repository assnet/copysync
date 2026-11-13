import type { IOfferHuntFindRepository } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { IEntitlementReader } from '../../../domain/contracts/IEntitlementReader';
import type { OfferHuntFind } from '../../../domain/hunter/OfferHunt';
import type { HuntFindDelivery } from '../../services/hunter/HuntFindDelivery';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { PlanFeatureUnavailableError } from '../../../../../shared/errors/internal/PlanErrors';
import {
  OfferHuntNotFoundError, OfferHuntResendNotDeliveredError, OfferHuntResendPendingError,
} from '../../../../../shared/errors/internal/OfferHuntErrors';
import { logger } from '../../../../../shared/logger/logger';

/** Dois reenvios do mesmo achado dentro disto = clique duplo/2 abas: o 2º é recusado (CAS em `lastResentAt`). */
export const HUNT_FIND_RESEND_COOLDOWN_MS = 60_000;

export interface ResendHuntFindDeps {
  finds: Pick<IOfferHuntFindRepository, 'findById' | 'claimResend' | 'recordResend'>;
  entitlements: IEntitlementReader;
  delivery: Pick<HuntFindDelivery, 'resend' | 'requireDestination'>;
  now?: () => Date;
}

/**
 * "Reenviar" um achado que já teve oferta: link do tenant regerado, preço/foto atuais, destino ATUAL e
 * `sourceKey` novo (`HuntFindDelivery.resend`). Portões: plano Shein e caçador aqui; credencial e aceite
 * `OFFER_HUNTER` no Resolve. Não é achado novo: não conta no teto do dia nem na guarda de 24 execuções.
 * Sem oferta → 409 `OFFER_HUNT_RESEND_NOT_DELIVERED`; disparo anterior QUEUED/SENDING (ou reenvio há < 60 s)
 * → 409 `OFFER_HUNT_RESEND_PENDING`; outro tenant → 404.
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
    const pending = find.delivery?.dispatchStatus;
    if (pending === 'QUEUED' || pending === 'SENDING') throw new OfferHuntResendPendingError();
    const destination = await delivery.requireDestination(tenantId);
    const now = this.deps.now?.() ?? new Date();
    if (!(await finds.claimResend(tenantId, findId, find.offerId, now, HUNT_FIND_RESEND_COOLDOWN_MS))) {
      throw new OfferHuntResendPendingError();
    }
    const offerId = await delivery.resend(tenantId, find, destination, now);
    await finds.recordResend(tenantId, findId, offerId);
    logger.info({ tenantId, findId, offerId }, 'offer hunt find resent');
    return (await finds.findById(tenantId, findId)) ?? { ...find, offerId, status: 'SENT', resendCount: find.resendCount + 1, lastResentAt: now };
  }
}
