import { Prisma } from '@prisma/client';
import type {
  OfferHunt as PrismaOfferHunt,
  OfferHuntFind as PrismaOfferHuntFind,
  OfferHuntRun as PrismaOfferHuntRun,
  OfferHunterSettings as PrismaOfferHunterSettings,
} from '@prisma/client';
import type { HuntCommissionBand, HuntScoreFactor, HuntSort } from '../../domain/hunter/HuntCandidate';
import type { OfferHunt, OfferHuntDefinition, OfferHuntFind, OfferHuntFindSnapshot, OfferHunterSettings, OfferHuntRun } from '../../domain/hunter/OfferHunt';
import { COMM_RATE, SORT_CODE } from '../http/SheinCatalogClient';

// O banco guarda os códigos da própria fonte (sort 0/7/9…, commRate 1–5); o domínio usa os nomes.
const SORT_OF_CODE = new Map(Object.entries(SORT_CODE).map(([k, v]) => [v, k as HuntSort]));
const BAND_OF_CODE = new Map(Object.entries(COMM_RATE).map(([k, v]) => [v, k as HuntCommissionBand]));

const num = (d: Prisma.Decimal | null): number | null => (d === null ? null : d.toNumber());
const dec = (n: number | null | undefined): Prisma.Decimal | null =>
  typeof n === 'number' && Number.isFinite(n) ? new Prisma.Decimal(n) : null;

/** Lê fatores gravados; entrada estranha vira lista vazia (só exibição). */
function factorsOf(raw: Prisma.JsonValue): HuntScoreFactor[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f) => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return [];
    const { key, points, max } = f as Record<string, unknown>;
    return typeof key === 'string' && typeof points === 'number' && typeof max === 'number'
      ? [{ key: key as HuntScoreFactor['key'], points, max }]
      : [];
  });
}

export class PrismaOfferHuntMapper {
  static huntToDomain(raw: PrismaOfferHunt): OfferHunt {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      name: raw.name,
      status: raw.status,
      pauseReason: raw.pauseReason,
      sort: SORT_OF_CODE.get(raw.sort) ?? 'RECOMMENDED',
      categoryId: raw.categoryId,
      commissionBand: raw.commissionBand === null ? null : (BAND_OF_CODE.get(raw.commissionBand) ?? null),
      keyword: raw.keyword,
      filters: {
        minPriceCents: raw.minPriceCents,
        maxPriceCents: raw.maxPriceCents,
        minDiscountPct: raw.minDiscountPercent,
        minCommissionPct: num(raw.minCommissionPercent),
        minCommissionCents: raw.minCommissionCents,
        minRating: num(raw.minRating),
        minSales: raw.minSalesBucket,
        minReviews: raw.minReviewsBucket,
        onlyWithExtra: raw.extraCommissionOnly,
        endsWithinDays: raw.endsWithinDays,
      },
      aiEnabled: raw.aiEnabled,
      topN: raw.topN,
      repeatAfterDays: raw.repeatAfterDays,
      deliveryMode: raw.deliveryMode,
      intervalMinutes: raw.intervalMinutes,
      windowStartMinute: raw.windowStartMinute,
      windowEndMinute: raw.windowEndMinute,
      weekdaysMask: raw.weekdaysMask,
      nextRunAt: raw.nextRunAt,
      lastRunAt: raw.lastRunAt,
      consecutiveFailures: raw.consecutiveFailures,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  /** Definição (parcial) → colunas. Campo ausente não entra no `data`. */
  static definitionToData(d: Partial<OfferHuntDefinition>): Prisma.OfferHuntUncheckedUpdateInput {
    const out: Prisma.OfferHuntUncheckedUpdateInput = {};
    if (d.name !== undefined) out.name = d.name;
    if (d.sort !== undefined) out.sort = SORT_CODE[d.sort];
    if (d.categoryId !== undefined) out.categoryId = d.categoryId;
    if (d.commissionBand !== undefined) out.commissionBand = d.commissionBand === null ? null : COMM_RATE[d.commissionBand];
    if (d.keyword !== undefined) out.keyword = d.keyword;
    if (d.filters !== undefined) {
      const f = d.filters;
      out.minPriceCents = f.minPriceCents ?? null;
      out.maxPriceCents = f.maxPriceCents ?? null;
      out.minDiscountPercent = f.minDiscountPct ?? null;
      out.minCommissionPercent = dec(f.minCommissionPct);
      out.minCommissionCents = f.minCommissionCents ?? null;
      out.minRating = dec(f.minRating);
      out.minSalesBucket = f.minSales ?? null;
      out.minReviewsBucket = f.minReviews ?? null;
      out.extraCommissionOnly = f.onlyWithExtra === true;
      out.endsWithinDays = f.endsWithinDays ?? null;
    }
    for (const k of ['aiEnabled', 'topN', 'repeatAfterDays', 'deliveryMode', 'intervalMinutes', 'windowStartMinute', 'windowEndMinute', 'weekdaysMask'] as const) {
      if (d[k] !== undefined) (out as Record<string, unknown>)[k] = d[k];
    }
    return out;
  }

  static runToDomain(raw: PrismaOfferHuntRun): OfferHuntRun {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      huntId: raw.huntId,
      trigger: raw.trigger,
      status: raw.status,
      seenCount: raw.seenCount,
      matchedCount: raw.matchedCount,
      chosenCount: raw.chosenCount,
      sentCount: raw.sentCount,
      aiUsed: raw.aiUsed,
      aiFallback: raw.aiFallback,
      errorCode: raw.errorCode,
      startedAt: raw.startedAt,
      finishedAt: raw.finishedAt,
    };
  }

  static findToDomain(raw: PrismaOfferHuntFind): OfferHuntFind {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      huntId: raw.huntId,
      runId: raw.runId,
      goodsId: raw.goodsId,
      skcCode: raw.skcCode,
      activityId: raw.activityId,
      title: raw.title,
      imageUrl: raw.imageUrl,
      priceCents: raw.priceCents,
      originalPriceCents: raw.originalPriceCents,
      discountPercent: raw.discountPercent,
      commissionPercent: num(raw.commissionPercent),
      commissionCents: raw.commissionCents,
      returningCommissionPercent: num(raw.returningCommissionPercent),
      returningCommissionCents: raw.returningCommissionCents,
      extraCommissionCents: raw.extraCommissionCents,
      salesBucket: raw.salesBucket,
      reviewsBucket: raw.reviewsBucket,
      rating: num(raw.rating),
      score: raw.score,
      factors: factorsOf(raw.factors),
      aiReason: raw.aiReason,
      status: raw.status,
      failureReason: raw.failureReason,
      offerId: raw.offerId,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  static snapshotToData(s: OfferHuntFindSnapshot) {
    return {
      goodsId: s.goodsId,
      skcCode: s.skcCode,
      activityId: s.activityId,
      title: s.title,
      imageUrl: s.imageUrl,
      priceCents: s.priceCents,
      originalPriceCents: s.originalPriceCents,
      discountPercent: s.discountPercent,
      commissionPercent: dec(s.commissionPercent),
      commissionCents: s.commissionCents,
      returningCommissionPercent: dec(s.returningCommissionPercent),
      returningCommissionCents: s.returningCommissionCents,
      extraCommissionCents: s.extraCommissionCents,
      salesBucket: s.salesBucket,
      reviewsBucket: s.reviewsBucket,
      rating: dec(s.rating),
      score: Math.round(s.score),
      factors: s.factors.map((f) => ({ key: f.key, points: f.points, max: f.max })) as Prisma.InputJsonValue,
      aiReason: s.aiReason,
    };
  }

  static settingsToDomain(raw: PrismaOfferHunterSettings): OfferHunterSettings {
    return { tenantId: raw.tenantId, sessionId: raw.sessionId, conversationId: raw.conversationId, updatedAt: raw.updatedAt };
  }
}
