import type { IOfferHuntFindRepository } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { IEntitlementReader } from '../../../domain/contracts/IEntitlementReader';
import type { OfferHuntFind, OfferHuntFindStatus } from '../../../domain/hunter/OfferHunt';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { PlanFeatureUnavailableError } from '../../../../../shared/errors/internal/PlanErrors';
import { OfferHuntFindInvalidStateError, OfferHuntNotFoundError } from '../../../../../shared/errors/internal/OfferHuntErrors';
import type { HuntFindDelivery } from '../../services/hunter/HuntFindDelivery';

/** Estados de onde aprovar/dispensar sai (FAILED pode tentar de novo: o Enqueue é idempotente por `sourceKey`). */
const DECIDABLE: OfferHuntFindStatus[] = ['PENDING_REVIEW', 'FAILED'];
/**
 * APPROVED sem `offerId` há mais que isto = entrega interrompida (processo caiu entre aprovar e entregar):
 * volta a ser decidível. Reivindicação por CAS em `updatedAt` (`reclaimStaleApproved`).
 */
export const HUNT_FIND_STALE_APPROVED_MS = 15 * 60_000;

export interface HuntFindDecisionInput {
  tenantId: string;
  findId: string;
}

export interface ApproveHuntFindOutput {
  find: OfferHuntFind;
  offerId: string;
}

type DecisionFinds = Pick<IOfferHuntFindRepository, 'findById' | 'transition' | 'reclaimStaleApproved'>;

export interface ApproveHuntFindDeps {
  finds: DecisionFinds;
  entitlements: IEntitlementReader;
  delivery: Pick<HuntFindDelivery, 'deliver' | 'requireDestination'>;
  now?: () => Date;
}

const staleBefore = (now: Date) => new Date(now.getTime() - HUNT_FIND_STALE_APPROVED_MS);
const isStaleApproved = (find: OfferHuntFind, now: Date) =>
  find.status === 'APPROVED' && find.offerId === null && find.updatedAt.getTime() < staleBefore(now).getTime();

async function loadDecidable(finds: Pick<IOfferHuntFindRepository, 'findById'>, tenantId: string, findId: string, now: Date): Promise<OfferHuntFind> {
  const find = await finds.findById(tenantId, findId);
  if (!find) throw new OfferHuntNotFoundError('find');
  if (!DECIDABLE.includes(find.status) && !isStaleApproved(find, now)) throw new OfferHuntFindInvalidStateError(find.status);
  return find;
}

/** CAS para APPROVED: de PENDING_REVIEW/FAILED, ou retomada de APPROVED preso. Perdeu a corrida → 409. */
async function claimApproved(finds: DecisionFinds, find: OfferHuntFind, now: Date): Promise<void> {
  const ok = find.status === 'APPROVED'
    ? await finds.reclaimStaleApproved(find.tenantId, find.id, staleBefore(now))
    : await finds.transition(find.tenantId, find.id, DECIDABLE, 'APPROVED', { failureReason: null });
  if (!ok) {
    const current = await finds.findById(find.tenantId, find.id);
    throw new OfferHuntFindInvalidStateError(current?.status ?? 'UNKNOWN');
  }
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
    const now = this.deps.now?.() ?? new Date();
    const find = await loadDecidable(this.deps.finds, tenantId, findId, now);
    const destination = await this.deps.delivery.requireDestination(tenantId);
    // CAS: dois cliques não entregam duas vezes
    await claimApproved(this.deps.finds, find, now);
    const r = await this.deps.delivery.deliver(tenantId, { ...find, status: 'APPROVED' }, destination);
    if (r.status === 'FAILED') throw r.error ?? new OfferHuntFindInvalidStateError('FAILED');
    const updated = await this.deps.finds.findById(tenantId, findId);
    return { find: updated ?? { ...find, status: 'SENT', offerId: r.offerId }, offerId: r.offerId };
  }
}

/** Dispensa um achado. Continua contando no teto do dia (design: todo achado gravado conta). */
export class DismissHuntFindUseCase {
  constructor(private readonly deps: { finds: DecisionFinds; now?: () => Date }) {}

  async execute(input: HuntFindDecisionInput): Promise<OfferHuntFind> {
    const { tenantId, findId } = input;
    const now = this.deps.now?.() ?? new Date();
    const find = await loadDecidable(this.deps.finds, tenantId, findId, now);
    // APPROVED preso: reivindica primeiro (CAS em updatedAt) e só então dispensa
    if (find.status === 'APPROVED') await claimApproved(this.deps.finds, find, now);
    const from: OfferHuntFindStatus[] = find.status === 'APPROVED' ? ['APPROVED'] : DECIDABLE;
    if (!(await this.deps.finds.transition(tenantId, findId, from, 'DISMISSED'))) {
      const current = await this.deps.finds.findById(tenantId, findId);
      throw new OfferHuntFindInvalidStateError(current?.status ?? 'UNKNOWN');
    }
    return { ...find, status: 'DISMISSED' };
  }
}
