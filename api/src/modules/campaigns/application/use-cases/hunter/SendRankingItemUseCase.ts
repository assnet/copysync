import type { IOfferHuntRepository } from '../../../domain/contracts/hunter/IOfferHuntRepository';
import type { IOfferHuntRunRepository } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { IOfferHuntFindRepository, NewOfferHuntFind } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { IHuntProviderRegistry } from '../../../domain/contracts/hunter/IHuntProviderAdapter';
import type { OfferHunt, OfferHuntFind, OfferHuntRankingItem, OfferHuntRun } from '../../../domain/hunter/OfferHunt';
import { HUNT_RANKING_REUSE_MAX_AGE_HOURS, isRankingWithinReuseWindow } from '../../../domain/services/hunter/rankingReuse';
import {
  OfferHuntAlreadySentError, OfferHuntDeliveryFailedError, OfferHuntFindInvalidStateError, OfferHuntNotFoundError, OfferHuntRankingExpiredError,
} from '../../../../../shared/errors/internal/OfferHuntErrors';
import { AppError } from '../../../../../shared/errors/AppError';
import { logger } from '../../../../../shared/logger/logger';
import { assertHuntBrandGates, type HuntBrandGateDeps } from '../../services/hunter/huntProviderGates';
import type { HuntFindDelivery } from '../../services/hunter/HuntFindDelivery';

const DAY_MS = 86_400_000;

export interface SendRankingItemInput {
  tenantId: string;
  huntId: string;
  runId: string;
  productId: string;
  /** Super admin (token): sem a janela de 48 h. */
  ignoreAgeLimit?: boolean;
  /** Do token: loja com flag "Só super admin" só passa para super admin. */
  isSuperAdmin: boolean;
}

export interface SendRankingItemDeps extends HuntBrandGateDeps {
  hunts: Pick<IOfferHuntRepository, 'findById'>;
  runs: Pick<IOfferHuntRunRepository, 'findById'>;
  finds: Pick<IOfferHuntFindRepository, 'insertRankingFind' | 'findById'>;
  providers: Pick<IHuntProviderRegistry, 'get'>;
  delivery: Pick<HuntFindDelivery, 'deliver' | 'requireDestination'>;
  now?: () => Date;
}

/** Caçada + execução + item carregados e na janela de 48 h (o "Enviar todas" reaproveita sem reler). */
export interface RankingContext {
  hunt: OfferHunt;
  run: OfferHuntRun;
  /** Quem pede (envio é sempre ação de usuário). */
  isSuperAdmin: boolean;
}

/**
 * Envia um item do ranking de uma execução ("Fora do corte"), manual. Caçada e execução do tenant; item no
 * `ranking` gravado (por `productId`); execução ≤ 48 h (`OFFER_HUNT_RANKING_EXPIRED`). Portões da marca como na
 * execução (plano da marca, caçador, credencial, aceite `OFFER_HUNTER`), **sem** o teto `offer_hunter_finds_per_day`
 * e sem a guarda de 24 execuções. Destino obrigatório. Grava o achado APPROVED no lock por tenant (já enviado desta
 * execução ou repetido em `repeatAfterDays` → 409 `OFFER_HUNT_ALREADY_SENT`) com `fromRanking` (fora do teto e do
 * `sentCount` da execução) e entrega pela `HuntFindDelivery` (`sourceKey hunt:<findId>`, a mesma de aprovar/retomada).
 * Falha na entrega: achado FAILED e sobe um `AppError` (erro cru de rede/banco vira `DELIVERY_FAILED`); o item pode
 * ser enviado de novo (linha nova).
 */
export class SendRankingItemUseCase {
  constructor(private readonly deps: SendRankingItemDeps) {}

  /** 404 (caçada/execução/sem ranking) ou 409 expirada (super admin com `ignoreAgeLimit` não expira). */
  async loadContext(input: Omit<SendRankingItemInput, 'productId'>, now: Date): Promise<RankingContext> {
    const { tenantId, huntId, runId } = input;
    const hunt = await this.deps.hunts.findById(tenantId, huntId);
    if (!hunt) throw new OfferHuntNotFoundError();
    const run = await this.deps.runs.findById(tenantId, huntId, runId);
    if (!run || !run.ranking) throw new OfferHuntNotFoundError('run');
    if (!input.ignoreAgeLimit && !isRankingWithinReuseWindow(run, now)) throw new OfferHuntRankingExpiredError(HUNT_RANKING_REUSE_MAX_AGE_HOURS);
    return { hunt, run, isSuperAdmin: input.isSuperAdmin };
  }

  async execute(input: SendRankingItemInput): Promise<OfferHuntFind> {
    const now = this.deps.now?.() ?? new Date();
    return this.send(await this.loadContext(input, now), input.productId, now);
  }

  /** Um item, com o contexto já carregado. */
  async send(ctx: RankingContext, productId: string, now: Date): Promise<OfferHuntFind> {
    const { hunt, run } = ctx;
    const tenantId = hunt.tenantId;
    const item = run.ranking?.find((i) => i.productId === productId);
    if (!item) throw new OfferHuntNotFoundError('run');
    const adapter = this.deps.providers.get(item.provider);
    await assertHuntBrandGates(this.deps, tenantId, adapter);
    const destination = await this.deps.delivery.requireDestination(tenantId);
    const repeatSince = new Date(now.getTime() - hunt.repeatAfterDays * DAY_MS);
    const inserted = await this.deps.finds.insertRankingFind(tenantId, toRankingFind(item, hunt.id, run.id), repeatSince);
    if (inserted.kind === 'ALREADY_SENT') throw new OfferHuntAlreadySentError(inserted.reason);
    const find = inserted.find;
    const r = await this.deps.delivery.deliver(tenantId, find, destination, { kind: 'user', isSuperAdmin: ctx.isSuperAdmin });
    if (r.status === 'FAILED') throw deliveryError(r.error);
    logger.info({ tenantId, huntId: hunt.id, runId: run.id, findId: find.id, offerId: r.offerId }, 'offer hunt ranking item sent');
    return (await this.deps.finds.findById(tenantId, find.id)) ?? { ...find, status: 'SENT', offerId: r.offerId };
  }
}

function deliveryError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return error ? new OfferHuntDeliveryFailedError() : new OfferHuntFindInvalidStateError('FAILED');
}

function toRankingFind(i: OfferHuntRankingItem, huntId: string, runId: string): NewOfferHuntFind & { runId: string; huntId: string } {
  return {
    huntId,
    runId,
    status: 'APPROVED',
    provider: i.provider,
    productId: i.productId,
    goodsId: i.provider === 'SHEIN' ? i.productId : null,
    skcCode: null,
    activityId: null,
    title: i.title ?? '',
    imageUrl: i.imageUrl,
    priceCents: i.priceCents,
    originalPriceCents: null,
    discountPercent: i.discountPercent,
    commissionPercent: i.commissionPercent,
    commissionCents: i.commissionCents,
    returningCommissionPercent: i.returningCommissionPercent,
    returningCommissionCents: i.returningCommissionCents,
    extraCommissionCents: i.extraCommissionCents,
    commissionEstimated: i.commissionEstimated,
    salesBucket: i.salesBucket,
    reviewsBucket: i.reviewsBucket,
    rating: i.rating,
    score: i.score,
    factors: i.factors,
    aiReason: i.aiReason,
  };
}
