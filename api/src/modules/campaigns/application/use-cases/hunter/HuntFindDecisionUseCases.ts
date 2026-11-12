import type { IOfferHuntFindRepository } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { IEntitlementReader } from '../../../domain/contracts/IEntitlementReader';
import type { OfferHuntFind, OfferHuntFindStatus } from '../../../domain/hunter/OfferHunt';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { PlanFeatureUnavailableError } from '../../../../../shared/errors/internal/PlanErrors';
import { OfferHuntFindInvalidStateError, OfferHuntNotFoundError } from '../../../../../shared/errors/internal/OfferHuntErrors';
import type { HuntFindDelivery } from '../../services/hunter/HuntFindDelivery';

/** Estados de onde aprovar/dispensar sai (FAILED pode tentar de novo: o Enqueue é idempotente por `sourceKey`). */
const DECIDABLE: OfferHuntFindStatus[] = ['PENDING_REVIEW', 'FAILED'];

export interface HuntFindDecisionInput {
  tenantId: string;
  findId: string;
}

export interface ApproveHuntFindOutput {
  find: OfferHuntFind;
  offerId: string;
}

export interface ApproveHuntFindDeps {
  finds: Pick<IOfferHuntFindRepository, 'findById' | 'transition'>;
  entitlements: IEntitlementReader;
  delivery: Pick<HuntFindDelivery, 'deliver' | 'requireDestination'>;
}

async function loadDecidable(finds: Pick<IOfferHuntFindRepository, 'findById'>, tenantId: string, findId: string): Promise<OfferHuntFind> {
  const find = await finds.findById(tenantId, findId);
  if (!find) throw new OfferHuntNotFoundError('find');
  if (!DECIDABLE.includes(find.status)) throw new OfferHuntFindInvalidStateError(find.status);
  return find;
}

/**
 * Aprova um achado (modo REVIEW) e entrega pelo mesmo caminho do modo AUTO. Destino obrigatório antes de
 * mexer no achado. Não gasta teto (o achado já contou ao ser gravado). Falha na entrega: achado FAILED e o
 * erro sobe (o painel mostra o motivo; aprovar de novo tenta outra vez).
 */
export class ApproveHuntFindUseCase {
  constructor(private readonly deps: ApproveHuntFindDeps) {}

  async execute(input: HuntFindDecisionInput): Promise<ApproveHuntFindOutput> {
    const { tenantId, findId } = input;
    if ((await this.deps.entitlements.getBoolean(tenantId, ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED)) !== true) {
      throw new PlanFeatureUnavailableError(ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED);
    }
    const find = await loadDecidable(this.deps.finds, tenantId, findId);
    const destination = await this.deps.delivery.requireDestination(tenantId);
    // CAS: dois cliques não entregam duas vezes
    if (!(await this.deps.finds.transition(tenantId, findId, DECIDABLE, 'APPROVED', { failureReason: null }))) {
      const now = await this.deps.finds.findById(tenantId, findId);
      throw new OfferHuntFindInvalidStateError(now?.status ?? 'UNKNOWN');
    }
    const r = await this.deps.delivery.deliver(tenantId, { ...find, status: 'APPROVED' }, destination);
    if (r.status === 'FAILED') throw r.error ?? new OfferHuntFindInvalidStateError('FAILED');
    const updated = await this.deps.finds.findById(tenantId, findId);
    return { find: updated ?? { ...find, status: 'SENT', offerId: r.offerId }, offerId: r.offerId };
  }
}

/** Dispensa um achado. Continua contando no teto do dia (design: todo achado gravado conta). */
export class DismissHuntFindUseCase {
  constructor(private readonly deps: { finds: Pick<IOfferHuntFindRepository, 'findById' | 'transition'> }) {}

  async execute(input: HuntFindDecisionInput): Promise<OfferHuntFind> {
    const { tenantId, findId } = input;
    const find = await loadDecidable(this.deps.finds, tenantId, findId);
    if (!(await this.deps.finds.transition(tenantId, findId, DECIDABLE, 'DISMISSED'))) {
      const now = await this.deps.finds.findById(tenantId, findId);
      throw new OfferHuntFindInvalidStateError(now?.status ?? 'UNKNOWN');
    }
    return { ...find, status: 'DISMISSED' };
  }
}
