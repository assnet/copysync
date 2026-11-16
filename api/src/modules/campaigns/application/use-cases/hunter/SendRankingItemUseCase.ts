import type { IOfferHuntRepository } from '../../../domain/contracts/hunter/IOfferHuntRepository';
import type { IOfferHuntRunRepository } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { IOfferHuntFindRepository, NewOfferHuntFind } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { IHuntProviderRegistry } from '../../../domain/contracts/hunter/IHuntProviderAdapter';
import type { OfferHunt, OfferHuntFind, OfferHuntRankingItem, OfferHuntRun } from '../../../domain/hunter/OfferHunt';
import { HUNT_RANKING_REUSE_MAX_AGE_HOURS, isRankingWithinReuseWindow } from '../../../domain/services/hunter/rankingReuse';
import {
  OfferHuntAlreadySentError, OfferHuntFindInvalidStateError, OfferHuntNotFoundError, OfferHuntRankingExpiredError,
} from '../../../../../shared/errors/internal/OfferHuntErrors';
import { logger } from '../../../../../shared/logger/logger';
import { assertHuntBrandGates, type HuntBrandGateDeps } from '../../services/hunter/huntProviderGates';
import { huntRankingSourceKey, type HuntFindDelivery } from '../../services/hunter/HuntFindDelivery';

const DAY_MS = 86_400_000;

export interface SendRankingItemInput {
  tenantId: string;
  huntId: string;
  runId: string;
  productId: string;
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
}

/**
 * Envia um item do ranking de uma execução ("Fora do corte"), manual. Caçada e execução do tenant; item no
 * `ranking` gravado (por `productId`); execução ≤ 48 h (`OFFER_HUNT_RANKING_EXPIRED`). Portões da marca como na
 * execução (plano da marca, caçador, credencial, aceite `OFFER_HUNTER`), **sem** o teto `offer_hunter_finds_per_day`
 * e sem a guarda de 24 execuções. Destino obrigatório. Grava o achado APPROVED no lock por tenant (já enviado desta
 * execução ou repetido em `repeatAfterDays` → 409 `OFFER_HUNT_ALREADY_SENT`) e entrega pela `HuntFindDelivery`
 * (`sourceKey hunt:rank:<runId>:<productId>`). Falha na entrega: achado FAILED e o erro sobe (aprovar tenta de novo).
 */
export class SendRankingItemUseCase {
  constructor(private readonly deps: SendRankingItemDeps) {}

  /** 404 (caçada/execução/sem ranking) ou 409 expirada. */
  async loadContext(input: Omit<SendRankingItemInput, 'productId'>, now: Date): Promise<RankingContext> {
    const { tenantId, huntId, runId } = input;
    const hunt = await this.deps.hunts.findById(tenantId, huntId);
    if (!hunt) throw new OfferHuntNotFoundError();
    const run = await this.deps.runs.findById(tenantId, huntId, runId);
    if (!run || !run.ranking) throw new OfferHuntNotFoundError('run');
    if (!isRankingWithinReuseWindow(run, now)) throw new OfferHuntRankingExpiredError(HUNT_RANKING_REUSE_MAX_AGE_HOURS);
    return { hunt, run };
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
    const r = await this.deps.delivery.deliver(tenantId, find, destination, { sourceKey: huntRankingSourceKey(run.id, item.productId) });
    if (r.status === 'FAILED') throw r.error ?? new OfferHuntFindInvalidStateError('FAILED');
    logger.info({ tenantId, huntId: hunt.id, runId: run.id, findId: find.id, offerId: r.offerId }, 'offer hunt ranking item sent');
    return (await this.deps.finds.findById(tenantId, find.id)) ?? { ...find, status: 'SENT', offerId: r.offerId };
  }
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
