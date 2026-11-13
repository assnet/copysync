import type { IOfferHuntRepository } from '../../../domain/contracts/hunter/IOfferHuntRepository';
import type { IOfferHuntRunRepository } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { IOfferHuntFindRepository, NewOfferHuntFind } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { IHuntProviderAdapter, IHuntProviderRegistry } from '../../../domain/contracts/hunter/IHuntProviderAdapter';
import type { HuntSourceOptions, HuntSourceSession } from '../../../domain/hunter/HuntProvider';
import type { IAffiliateCredentialGateway } from '../../../domain/contracts/IAffiliateCredentialGateway';
import type { IEntitlementReader } from '../../../domain/contracts/IEntitlementReader';
import type { IMarketplaceRiskGate } from '../../../domain/contracts/IMarketplaceRiskGate';
import type { HuntCandidate, HuntRejectionCounts, HuntScore, HuntScoreFactor } from '../../../domain/hunter/HuntCandidate';
import type { OfferHunt, OfferHuntFind, OfferHuntPauseReason, OfferHuntRankingItem, OfferHuntRunTrigger } from '../../../domain/hunter/OfferHunt';
import type { IHuntCandidateRanker } from '../../hunter/contracts/IHuntCandidateRanker';
import { HUNTER_LIMITS } from '../../../domain/services/hunter/hunterLimits';
import { countHuntRejections, huntFilterRejections } from '../../../domain/services/hunter/matchHuntFilters';
import { scoreHuntCandidate } from '../../../domain/services/hunter/scoreHuntCandidate';
import { startOfDayInZone } from '../../../domain/services/startOfDayInZone';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { currentRiskNoticeVersion } from '../../../../integrations/domain/services/marketplaceRiskNotice';
import { AppError } from '../../../../../shared/errors/AppError';
import { PlanFeatureUnavailableError } from '../../../../../shared/errors/internal/PlanErrors';
import { MarketplaceRiskNotAcceptedError } from '../../../../../shared/errors/internal/MarketplaceRiskErrors';
import {
  AffiliateApiRateLimitedError,
  AffiliateApiUnavailableError,
  AffiliateCredentialRejectedError,
  AffiliateCredentialRequiredError,
} from '../../../../../shared/errors/internal/OfferErrors';
import {
  OfferHuntDailyLimitError,
  OfferHuntNotFoundError,
  OfferHuntRunThrottledError,
  OfferHuntSourceUnavailableError,
} from '../../../../../shared/errors/internal/OfferHuntErrors';
import { logger } from '../../../../../shared/logger/logger';
import type { HuntDestination, HuntFindDelivery } from '../../services/hunter/HuntFindDelivery';
import { HUNT_PROVIDER_PLAN_KEY } from '../../services/hunter/huntProviderGates';

/** Fonte indisponível N execuções seguidas → pausa `SOURCE_UNAVAILABLE` (HUNT-13). */
export const HUNT_SOURCE_FAILURES_BEFORE_PAUSE = 3;
/** Pausa entre páginas (ms): sorteada em [min, max]. */
export const HUNT_PAGE_PAUSE_MS = { min: 1_000, max: 2_000 } as const;
const DAY_MS = 86_400_000;

export interface RunOfferHuntInput {
  tenantId: string;
  huntId: string;
  trigger: OfferHuntRunTrigger;
  now: Date;
}

/** Item do ranking da execução (o "Testar agora" mostra e a execução grava). Sem link nem token. */
export type HuntRankingItem = OfferHuntRankingItem;

export interface RunOfferHuntOutput {
  /** null só quando pulada sem registro (não acontece hoje: toda pulada grava a execução). */
  runId: string | null;
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  /** Código do motivo (pulada/falha). */
  errorCode: string | null;
  seenCount: number;
  matchedCount: number;
  chosenCount: number;
  sentCount: number;
  aiUsed: boolean;
  aiFallback: boolean;
  /** Candidatos barrados por filtro local (chave = campo do filtro) e `repeated`; null = não chegou à fonte. */
  rejectedBy: HuntRejectionCounts | null;
  /** Até `HUNTER_LIMITS.aiTopCandidates` melhores, na ordem final (também gravado na execução). */
  ranking: HuntRankingItem[];
  finds: OfferHuntFind[];
  /** Saldo do teto do dia depois da execução. */
  remainingToday: number;
  /** Caçada pausada por esta execução. */
  pausedReason: OfferHuntPauseReason | null;
}

export interface RunOfferHuntDeps {
  hunts: Pick<IOfferHuntRepository, 'findById' | 'pause' | 'recordSuccess' | 'recordSourceFailure'>;
  runs: Pick<IOfferHuntRunRepository, 'startWithinDailyLimit' | 'createSkipped' | 'finish'>;
  finds: Pick<IOfferHuntFindRepository, 'insertWithinDailyLimit' | 'countCreatedSince' | 'recentProductIds' | 'transition'>;
  /** Adaptador da marca da caçada (sessão, catálogo, URL, fotos). */
  providers: IHuntProviderRegistry;
  /** Mesmo caminho do monitoramento: estado da credencial e marcação de recusa (com auditoria). */
  credentials: Pick<IAffiliateCredentialGateway, 'resolveState' | 'markRejected'>;
  entitlements: IEntitlementReader;
  riskGate: IMarketplaceRiskGate;
  ranker: IHuntCandidateRanker;
  delivery: Pick<HuntFindDelivery, 'deliver' | 'requireDestination'>;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
}

interface Scored {
  candidate: HuntCandidate;
  score: HuntScore;
  aiReason: string | null;
}

/** Recusa de portão: código da execução pulada + erro do modo manual + pausa (agendado). */
class GateRefusal {
  constructor(readonly error: AppError, readonly pause: OfferHuntPauseReason | null = null) {}
}

/**
 * Uma execução da caçada (HUNT-10/12/16, MM-05), da marca da caçada. Portões na ordem, todos antes de qualquer
 * chamada à fonte: plano da marca (Shein) → caçador → credencial com sessão da marca → aceite `OFFER_HUNTER` da
 * marca → saldo do teto > 0 (somado entre marcas) → (AUTO: destino) → guarda de execuções/dia. Recusado: MANUAL
 * lança o erro; SCHEDULED grava a execução SKIPPED. Depois: ≤ 3 páginas, filtros locais, pontuação, sem
 * repetidos (marca + produto), IA opcional, `min(topN, saldo)` gravados atomicamente; AUTO entrega pela
 * `HuntFindDelivery`. A sessão só vai à fonte da marca.
 */
export class RunOfferHuntUseCase {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly rand: () => number;

  constructor(private readonly deps: RunOfferHuntDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.rand = deps.rand ?? Math.random;
  }

  async execute(input: RunOfferHuntInput): Promise<RunOfferHuntOutput> {
    const { tenantId, huntId, trigger, now } = input;
    const hunt = await this.deps.hunts.findById(tenantId, huntId);
    if (!hunt) throw new OfferHuntNotFoundError();
    const since = startOfDayInZone(now);
    const provider = hunt.provider;
    const adapter = this.deps.providers.get(provider);
    const base = { tenantId, huntId, provider, trigger, startedAt: now };
    // Job com posse velha de caçada pausada depois do claim: não roda
    if (trigger === 'SCHEDULED' && hunt.status === 'PAUSED') {
      const run = await this.deps.runs.createSkipped({ ...base, errorCode: 'OFFER_HUNT_PAUSED' });
      return emptyOutput(run.id, 'SKIPPED', 'OFFER_HUNT_PAUSED', null);
    }

    let session: HuntSourceSession;
    let limit: number;
    let balance: number;
    let destination: HuntDestination | null = null;
    try {
      ({ session, limit, balance } = await this.checkGates(tenantId, adapter, since));
      if (hunt.deliveryMode === 'AUTO') destination = await this.deps.delivery.requireDestination(tenantId);
    } catch (err) {
      const refusal = err instanceof GateRefusal ? err : err instanceof AppError ? new GateRefusal(err) : null;
      if (!refusal) throw err;
      return this.refuse(input, hunt, refusal);
    }

    const run = await this.deps.runs.startWithinDailyLimit(base, { since, limit: HUNTER_LIMITS.runsPerDayMax });
    if (!run) return this.refuse(input, hunt, new GateRefusal(new OfferHuntRunThrottledError(HUNTER_LIMITS.runsPerDayMax)));

    const counters = {
      seenCount: 0, matchedCount: 0, chosenCount: 0, sentCount: 0, aiUsed: false, aiFallback: false,
      rejectedBy: null as HuntRejectionCounts | null,
    };
    let ranking: HuntRankingItem[] | null = null;
    try {
      const items = await this.fetchCandidates(hunt, adapter, session);
      counters.seenCount = items.length;
      // Toda chave que barrou conta (o painel explica "0 no filtro"); passa/não passa = matchHuntFilters
      const rejectedBy: HuntRejectionCounts = {};
      counters.rejectedBy = rejectedBy;
      const matched = items.filter((c) => {
        const keys = huntFilterRejections(c, hunt.filters, now);
        countHuntRejections(rejectedBy, keys);
        return keys.length === 0;
      });
      counters.matchedCount = matched.length;
      const repeatSince = new Date(now.getTime() - hunt.repeatAfterDays * DAY_MS);
      const recent = await this.deps.finds.recentProductIds(tenantId, hunt.id, provider, repeatSince);
      const fresh: Scored[] = matched
        .filter((c) => {
          if (!recent.has(c.productId)) return true;
          countHuntRejections(rejectedBy, ['repeated']);
          return false;
        })
        .map((candidate) => ({ candidate, score: scoreHuntCandidate(candidate, now), aiReason: null }))
        .sort((a, b) => b.score.score - a.score.score);

      const pick = Math.min(hunt.topN, balance);
      const top = fresh.slice(0, HUNTER_LIMITS.aiTopCandidates);
      const ordered = hunt.aiEnabled && top.length > 0 ? await this.rankWithAi(tenantId, top, pick, counters) : top;
      const chosen = ordered.slice(0, pick);

      const inserted = await this.deps.finds.insertWithinDailyLimit(
        tenantId,
        chosen.map((s) => toNewFind(s, hunt, run.id)),
        // Repetição rechecada no lock: execução simultânea da mesma caçada pode ter gravado o mesmo item
        { since, limit, repeatSince },
      );
      counters.chosenCount = inserted.length;

      if (destination) {
        for (const [i, find] of inserted.entries()) {
          const r = await this.deps.delivery.deliver(tenantId, find, destination);
          if (r.status === 'SENT') counters.sentCount++;
          else if (r.error instanceof AffiliateCredentialRejectedError) {
            // Loja recusou: os demais não chamam a loja (ficariam APPROVED sem envio)
            for (const rest of inserted.slice(i + 1)) {
              await this.deps.finds.transition(tenantId, rest.id, ['APPROVED'], 'FAILED', { failureReason: r.error.code });
            }
            throw r.error;
          }
        }
      }

      const chosenIds = new Set(inserted.map((f) => f.productId));
      ranking = ordered.map((s) => toRankingItem(s, chosenIds.has(s.candidate.productId)));
      await this.deps.runs.finish(tenantId, run.id, { ...counters, ranking, status: 'SUCCEEDED', errorCode: null, finishedAt: now });
      await this.deps.hunts.recordSuccess(tenantId, hunt.id, now);
      return {
        runId: run.id, status: 'SUCCEEDED', errorCode: null, ...counters,
        ranking,
        finds: inserted,
        remainingToday: Math.max(0, balance - inserted.length),
        pausedReason: null,
      };
    } catch (err) {
      return this.failRun(input, hunt, run.id, counters, ranking, err, balance);
    }
  }

  private async checkGates(
    tenantId: string, adapter: IHuntProviderAdapter, since: Date,
  ): Promise<{ session: HuntSourceSession; limit: number; balance: number }> {
    const { entitlements } = this.deps;
    const provider = adapter.provider;
    const planKey = HUNT_PROVIDER_PLAN_KEY[provider];
    if (planKey && (await entitlements.getBoolean(tenantId, planKey)) !== true) {
      throw new GateRefusal(new PlanFeatureUnavailableError(planKey), 'PLAN_UNAVAILABLE');
    }
    if ((await entitlements.getBoolean(tenantId, ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED)) !== true) {
      throw new GateRefusal(new PlanFeatureUnavailableError(ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED), 'PLAN_UNAVAILABLE');
    }
    const state = await this.deps.credentials.resolveState(tenantId, provider);
    if (state.state === 'rejected') throw new GateRefusal(new AffiliateCredentialRejectedError(provider), 'CREDENTIAL_REJECTED');
    const session = state.state === 'ok' ? adapter.sessionFrom(state.cred) : null;
    if (!session) throw new GateRefusal(new AffiliateCredentialRequiredError(provider));
    if (!(await this.deps.riskGate.isAccepted(tenantId, provider, 'OFFER_HUNTER'))) {
      throw new GateRefusal(
        new MarketplaceRiskNotAcceptedError(provider, currentRiskNoticeVersion(provider, 'OFFER_HUNTER') ?? '', 'OFFER_HUNTER'),
        'RISK_NOT_ACCEPTED',
      );
    }
    // Lido a cada execução; ausente = 0 (nunca "ilimitado" como no gerador)
    const limit = (await entitlements.getNumber(tenantId, ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY)) ?? 0;
    const used = await this.deps.finds.countCreatedSince(tenantId, since);
    const balance = Math.max(0, limit - used);
    if (balance <= 0) throw new GateRefusal(new OfferHuntDailyLimitError(limit));
    return { session, limit, balance };
  }

  /**
   * ≤ 1 categorias + ≤ 3 páginas; para em `hasNextPage = false`; sem item repetido. A categoria vai à fonte como
   * a entrada listada por ela ("Todas" = `categoryId` null; o adaptador leva o que precisar, ex. `did` Shein).
   * Shein: a faixa da fonte (`categoryRate`/`commRate`) filtra a comissão de RECOMPRA e nunca é usada; comissão
   * é filtro local. Ordenação: Shein = `hunt.sort`; demais = `sourceOptions.sort` (ou a padrão da marca).
   */
  private async fetchCandidates(hunt: OfferHunt, adapter: IHuntProviderAdapter, session: HuntSourceSession): Promise<HuntCandidate[]> {
    const { catalog, capabilities } = adapter;
    const categories = await catalog.listCategories(session);
    const match = hunt.categoryId ? categories.find((c) => c.categoryId === hunt.categoryId) : categories.find((c) => c.categoryId === null);
    // Categoria sumiu da fonte (ou lista sem "Todas"): mesma régua de fonte indisponível
    if (!match) throw new AffiliateApiUnavailableError(adapter.provider);
    const options: HuntSourceOptions = adapter.provider === 'SHEIN'
      ? { sort: hunt.sort }
      : { ...hunt.sourceOptions, sort: hunt.sourceOptions?.sort ?? capabilities.defaultSort };
    const seen = new Map<string, HuntCandidate>();
    for (let page = 1; page <= HUNTER_LIMITS.pagesPerRunMax; page++) {
      if (page > 1) await this.sleep(HUNT_PAGE_PAUSE_MS.min + Math.floor(this.rand() * (HUNT_PAGE_PAUSE_MS.max - HUNT_PAGE_PAUSE_MS.min + 1)));
      const res = await catalog.fetchPage(session, { page, category: match, keyword: hunt.keyword, options });
      // Item de outra marca (adaptador com defeito) não entra
      for (const item of res.items) if (item.provider === adapter.provider && !seen.has(item.productId)) seen.set(item.productId, item);
      if (!res.hasNextPage) break;
    }
    return [...seen.values()];
  }

  /** IA reordena o top 15; `null`/erro → ordem determinística (aiFallback). Faltou item: completa pela pontuação. */
  private async rankWithAi(tenantId: string, top: Scored[], pick: number, counters: { aiUsed: boolean; aiFallback: boolean }): Promise<Scored[]> {
    let picks: Awaited<ReturnType<IHuntCandidateRanker['rank']>> = null;
    try {
      picks = await this.deps.ranker.rank({ tenantId, candidates: top.map(({ candidate, score }) => ({ candidate, score })), topN: pick });
    } catch {
      picks = null;
    }
    if (!picks || picks.length === 0) {
      counters.aiFallback = true;
      return top;
    }
    counters.aiUsed = true;
    const byId = new Map(top.map((s) => [s.candidate.productId, s]));
    const first: Scored[] = [];
    for (const p of picks) {
      const s = byId.get(p.productId);
      if (!s || first.includes(s)) continue;
      first.push({ ...s, aiReason: p.reason });
    }
    const taken = new Set(first.map((s) => s.candidate.productId));
    return [...first, ...top.filter((s) => !taken.has(s.candidate.productId))];
  }

  /** Portão recusado: MANUAL lança; SCHEDULED grava SKIPPED (e pausa quando o motivo exige). */
  private async refuse(input: RunOfferHuntInput, hunt: OfferHunt, refusal: GateRefusal): Promise<RunOfferHuntOutput> {
    if (input.trigger === 'MANUAL') throw refusal.error;
    const { tenantId, huntId, trigger, now } = input;
    if (refusal.pause) await this.deps.hunts.pause(tenantId, hunt.id, refusal.pause);
    const run = await this.deps.runs.createSkipped({
      tenantId, huntId, provider: hunt.provider, trigger, startedAt: now, errorCode: refusal.error.code,
    });
    logger.info({ tenantId, huntId, code: refusal.error.code }, 'offer hunt run skipped');
    return emptyOutput(run.id, 'SKIPPED', refusal.error.code, refusal.pause);
  }

  private async failRun(
    input: RunOfferHuntInput, hunt: OfferHunt, runId: string,
    counters: Omit<RunOfferHuntOutput, 'runId' | 'status' | 'errorCode' | 'ranking' | 'finds' | 'remainingToday' | 'pausedReason'>,
    ranking: HuntRankingItem[] | null, err: unknown, balance: number,
  ): Promise<RunOfferHuntOutput> {
    const { tenantId, now } = input;
    const code = err instanceof AppError ? err.code : 'UNEXPECTED';
    let paused: OfferHuntPauseReason | null = null;
    let thrown: unknown = err;
    if (err instanceof AffiliateCredentialRejectedError) {
      await this.deps.credentials.markRejected(tenantId, hunt.provider, err.code);
      await this.deps.hunts.pause(tenantId, hunt.id, 'CREDENTIAL_REJECTED');
      paused = 'CREDENTIAL_REJECTED';
    } else if (err instanceof AffiliateApiUnavailableError || err instanceof AffiliateApiRateLimitedError) {
      const r = await this.deps.hunts.recordSourceFailure(tenantId, hunt.id, now, HUNT_SOURCE_FAILURES_BEFORE_PAUSE);
      if (r.paused) paused = 'SOURCE_UNAVAILABLE';
      thrown = new OfferHuntSourceUnavailableError(r.paused);
    }
    await this.deps.runs.finish(tenantId, runId, { ...counters, ranking, status: 'FAILED', errorCode: code, finishedAt: now });
    logger.warn({ tenantId, huntId: hunt.id, runId, code, paused }, 'offer hunt run failed');
    if (input.trigger === 'MANUAL') throw thrown;
    return { ...emptyOutput(runId, 'FAILED', code, paused), ...counters, ranking: ranking ?? [], remainingToday: balance };
  }
}

function emptyOutput(runId: string, status: 'FAILED' | 'SKIPPED', errorCode: string, pausedReason: OfferHuntPauseReason | null): RunOfferHuntOutput {
  return {
    runId, status, errorCode, seenCount: 0, matchedCount: 0, chosenCount: 0, sentCount: 0, aiUsed: false, aiFallback: false,
    rejectedBy: null,
    ranking: [], finds: [], remainingToday: 0, pausedReason,
  };
}

function toRankingItem(s: Scored, chosen: boolean): HuntRankingItem {
  const c = s.candidate;
  return {
    provider: c.provider, productId: c.productId, title: c.title, imageUrl: c.imageUrl, priceCents: c.priceCents, discountPercent: c.discountPct,
    commissionPercent: c.commissionNewPct, commissionCents: c.commissionNewCents,
    returningCommissionPercent: c.commissionReturningPct, returningCommissionCents: c.commissionReturningCents,
    extraCommissionCents: c.extraCommissionCents, commissionEstimated: c.commissionEstimated, salesBucket: c.sales, reviewsBucket: c.reviews, rating: c.rating,
    score: s.score.score, factors: s.score.factors, aiReason: s.aiReason, chosen,
  };
}

function toNewFind(s: Scored, hunt: OfferHunt, runId: string): NewOfferHuntFind {
  const c = s.candidate;
  return {
    huntId: hunt.id,
    runId,
    status: hunt.deliveryMode === 'AUTO' ? 'APPROVED' : 'PENDING_REVIEW',
    provider: c.provider,
    productId: c.productId,
    goodsId: c.provider === 'SHEIN' ? c.productId : null,
    skcCode: c.skc,
    activityId: c.activityId,
    title: c.title ?? '',
    imageUrl: c.imageUrl,
    priceCents: c.priceCents,
    originalPriceCents: c.retailPriceCents,
    discountPercent: c.discountPct,
    commissionPercent: c.commissionNewPct,
    commissionCents: c.commissionNewCents,
    returningCommissionPercent: c.commissionReturningPct,
    returningCommissionCents: c.commissionReturningCents,
    extraCommissionCents: c.extraCommissionCents,
    commissionEstimated: c.commissionEstimated,
    salesBucket: c.sales,
    reviewsBucket: c.reviews,
    rating: c.rating,
    score: s.score.score,
    factors: s.score.factors,
    aiReason: s.aiReason,
  };
}
