import type { OfferHunt, OfferHuntFind, OfferHuntRun, OfferHunterSettings } from '../../domain/hunter/OfferHunt';
import type { RunOfferHuntOutput, HuntRankingItem } from '../../application/use-cases/hunter/RunOfferHuntUseCase';
import type { OfferHuntPage } from '../../application/use-cases/hunter/OfferHuntHistoryUseCases';
import type { ApproveHuntFindOutput } from '../../application/use-cases/hunter/HuntFindDecisionUseCases';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const IMAGE_HOST = 'ltwebstatic.com';
/** Foto do achado só sai se for https em *.ltwebstatic.com, sem credencial/porta; qualquer outra origem = null. */
export function safeFindImageUrl(v: string | null): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    return host === IMAGE_HOST || host.endsWith(`.${IMAGE_HOST}`) ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Respostas do Caçador de Ofertas por lista fechada de campos: nada de `tenantId`, posse do job
 * (`claimToken`/`claimedUntil`), token, `memberId`, `skc`/`activityId` nem `did` da fonte.
 */
export const OfferHuntPresenter = {
  hunt(h: OfferHunt) {
    return {
      id: h.id,
      name: h.name,
      status: h.status,
      pauseReason: h.pauseReason,
      sort: h.sort,
      categoryId: h.categoryId,
      commissionBand: h.commissionBand,
      keyword: h.keyword,
      filters: {
        minPriceCents: h.filters.minPriceCents ?? null,
        maxPriceCents: h.filters.maxPriceCents ?? null,
        minDiscountPct: h.filters.minDiscountPct ?? null,
        minCommissionPct: h.filters.minCommissionPct ?? null,
        minCommissionCents: h.filters.minCommissionCents ?? null,
        minRating: h.filters.minRating ?? null,
        minSales: h.filters.minSales ?? null,
        minReviews: h.filters.minReviews ?? null,
        onlyWithExtra: h.filters.onlyWithExtra ?? null,
        endsWithinDays: h.filters.endsWithinDays ?? null,
      },
      aiEnabled: h.aiEnabled,
      topN: h.topN,
      repeatAfterDays: h.repeatAfterDays,
      deliveryMode: h.deliveryMode,
      intervalMinutes: h.intervalMinutes,
      windowStartMinute: h.windowStartMinute,
      windowEndMinute: h.windowEndMinute,
      weekdaysMask: h.weekdaysMask,
      nextRunAt: iso(h.nextRunAt),
      lastRunAt: iso(h.lastRunAt),
      consecutiveFailures: h.consecutiveFailures,
      createdAt: h.createdAt.toISOString(),
      updatedAt: h.updatedAt.toISOString(),
    };
  },

  run(r: OfferHuntRun) {
    return {
      id: r.id,
      huntId: r.huntId,
      trigger: r.trigger,
      status: r.status,
      errorCode: r.errorCode,
      seenCount: r.seenCount,
      matchedCount: r.matchedCount,
      chosenCount: r.chosenCount,
      sentCount: r.sentCount,
      aiUsed: r.aiUsed,
      aiFallback: r.aiFallback,
      startedAt: r.startedAt.toISOString(),
      finishedAt: iso(r.finishedAt),
    };
  },

  find(f: OfferHuntFind) {
    return {
      id: f.id,
      huntId: f.huntId,
      runId: f.runId,
      status: f.status,
      goodsId: f.goodsId,
      title: f.title,
      imageUrl: safeFindImageUrl(f.imageUrl),
      priceCents: f.priceCents,
      originalPriceCents: f.originalPriceCents,
      discountPercent: f.discountPercent,
      commissionPercent: f.commissionPercent,
      commissionCents: f.commissionCents,
      returningCommissionPercent: f.returningCommissionPercent,
      returningCommissionCents: f.returningCommissionCents,
      extraCommissionCents: f.extraCommissionCents,
      salesBucket: f.salesBucket,
      reviewsBucket: f.reviewsBucket,
      rating: f.rating,
      score: f.score,
      factors: f.factors.map((x) => ({ key: x.key, points: x.points, max: x.max })),
      aiReason: f.aiReason,
      failureReason: f.failureReason,
      offerId: f.offerId,
      createdAt: f.createdAt.toISOString(),
    };
  },

  rankingItem(i: HuntRankingItem) {
    return {
      goodsId: i.goodsId,
      title: i.title,
      imageUrl: i.imageUrl,
      priceCents: i.priceCents,
      score: i.score,
      factors: i.factors.map((x) => ({ key: x.key, points: x.points, max: x.max })),
      aiReason: i.aiReason,
      chosen: i.chosen,
    };
  },

  runResult(o: RunOfferHuntOutput) {
    return {
      runId: o.runId,
      status: o.status,
      errorCode: o.errorCode,
      seenCount: o.seenCount,
      matchedCount: o.matchedCount,
      chosenCount: o.chosenCount,
      sentCount: o.sentCount,
      aiUsed: o.aiUsed,
      aiFallback: o.aiFallback,
      ranking: o.ranking.map(OfferHuntPresenter.rankingItem),
      finds: o.finds.map(OfferHuntPresenter.find),
      remainingToday: o.remainingToday,
      pausedReason: o.pausedReason,
    };
  },

  runsPage(p: OfferHuntPage<OfferHuntRun>) {
    return { items: p.items.map(OfferHuntPresenter.run), nextCursor: p.nextCursor };
  },

  findsPage(p: OfferHuntPage<OfferHuntFind>) {
    return { items: p.items.map(OfferHuntPresenter.find), nextCursor: p.nextCursor };
  },

  approved(o: ApproveHuntFindOutput) {
    return { find: OfferHuntPresenter.find(o.find), offerId: o.offerId };
  },

  settings(s: OfferHunterSettings) {
    return { sessionId: s.sessionId, conversationId: s.conversationId, valid: !!(s.sessionId && s.conversationId) };
  },
};
