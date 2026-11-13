import { Prisma } from '@prisma/client';
import type {
  OfferHunt as PrismaOfferHunt,
  OfferHuntFind as PrismaOfferHuntFind,
  OfferHuntRun as PrismaOfferHuntRun,
  OfferHunterSettings as PrismaOfferHunterSettings,
} from '@prisma/client';
import { HUNT_REJECTION_KEYS, type HuntCommissionBand, type HuntRejectionCounts, type HuntRejectionKey, type HuntScoreFactor, type HuntSort } from '../../domain/hunter/HuntCandidate';
import type { OfferHunt, OfferHuntDefinition, OfferHuntFind, OfferHuntFindSnapshot, OfferHunterSettings, OfferHuntRankingItem, OfferHuntRun, OfferHuntRunSummary } from '../../domain/hunter/OfferHunt';
import { isHuntProvider, type HuntProvider, type HuntSourceOptions } from '../../domain/hunter/HuntProvider';
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

const REJECTION_KEYS: ReadonlySet<string> = new Set(HUNT_REJECTION_KEYS);

/** Lê `rejectedBy`: só chaves conhecidas com inteiro > 0; coluna nula ou não-objeto = null (`{}` = nada barrou). */
export function rejectionsOf(raw: Prisma.JsonValue | null | undefined): HuntRejectionCounts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: HuntRejectionCounts = {};
  for (const [k, v] of Object.entries(raw)) {
    if (REJECTION_KEYS.has(k) && typeof v === 'number' && Number.isInteger(v) && v > 0) out[k as HuntRejectionKey] = v;
  }
  return out;
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Marca gravada; ausente/estranha = SHEIN (tudo antes do multimarca era Shein). */
const providerOf = (v: unknown, fallback: HuntProvider = 'SHEIN'): HuntProvider => (isHuntProvider(v) ? v : fallback);

/**
 * Lê o ranking gravado; item sem id (`productId`, ou `goodsId` do JSON antigo) ou `score` some; coluna nula ou
 * não-lista = null. Item sem `provider` herda o da execução.
 */
export function rankingOf(raw: Prisma.JsonValue | null | undefined, runProvider: HuntProvider = 'SHEIN'): OfferHuntRankingItem[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((x) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return [];
    const o = x as Record<string, unknown>;
    const productId = typeof o.productId === 'string' ? o.productId : typeof o.goodsId === 'string' ? o.goodsId : null;
    if (productId === null || typeof o.score !== 'number') return [];
    return [{
      provider: providerOf(o.provider, runProvider), productId, title: strOrNull(o.title), imageUrl: strOrNull(o.imageUrl), priceCents: numOrNull(o.priceCents),
      discountPercent: numOrNull(o.discountPercent), commissionPercent: numOrNull(o.commissionPercent),
      commissionCents: numOrNull(o.commissionCents), returningCommissionPercent: numOrNull(o.returningCommissionPercent),
      returningCommissionCents: numOrNull(o.returningCommissionCents), extraCommissionCents: numOrNull(o.extraCommissionCents),
      commissionEstimated: o.commissionEstimated === true,
      salesBucket: numOrNull(o.salesBucket), reviewsBucket: numOrNull(o.reviewsBucket), rating: numOrNull(o.rating),
      score: o.score, factors: factorsOf((o.factors ?? null) as Prisma.JsonValue), aiReason: strOrNull(o.aiReason), chosen: o.chosen === true,
    }];
  });
}

/**
 * Grava o ranking só com a lista fechada de campos (nada além do que a tela mostra). Shein também leva `goodsId`
 * (= productId) para a leitura da versão anterior em caso de rollback.
 */
export function rankingToData(r: OfferHuntRankingItem[] | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (r === null) return Prisma.DbNull;
  return r.map((i) => ({
    provider: i.provider, productId: i.productId, ...(i.provider === 'SHEIN' ? { goodsId: i.productId } : {}), title: i.title, imageUrl: i.imageUrl, priceCents: i.priceCents, discountPercent: i.discountPercent,
    commissionPercent: i.commissionPercent, commissionCents: i.commissionCents, returningCommissionPercent: i.returningCommissionPercent,
    returningCommissionCents: i.returningCommissionCents, extraCommissionCents: i.extraCommissionCents,
    commissionEstimated: i.commissionEstimated, salesBucket: i.salesBucket,
    reviewsBucket: i.reviewsBucket, rating: i.rating, score: i.score,
    factors: i.factors.map((f) => ({ key: f.key, points: f.points, max: f.max })), aiReason: i.aiReason, chosen: i.chosen,
  })) as Prisma.InputJsonValue;
}

/** Grava `rejectedBy`: objeto vazio também vira `{}` (execução contou e nada barrou); null = SQL NULL. */
export function rejectionsToData(r: HuntRejectionCounts | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return r === null ? Prisma.DbNull : ({ ...r } as Prisma.InputJsonValue);
}

/** Lê `sourceOptions`: só as chaves conhecidas com o tipo certo; vazio/estranho = null. */
export function sourceOptionsOf(raw: Prisma.JsonValue | null | undefined): HuntSourceOptions | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: HuntSourceOptions = {};
  if (typeof o.sort === 'string') out.sort = o.sort;
  if (typeof o.extraEarningsOnly === 'boolean') out.extraEarningsOnly = o.extraEarningsOnly;
  if (typeof o.bestSellersOnly === 'boolean') out.bestSellersOnly = o.bestSellersOnly;
  return Object.keys(out).length > 0 ? out : null;
}

function sourceOptionsToData(o: HuntSourceOptions | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const v = sourceOptionsOf((o ?? null) as Prisma.JsonValue);
  return v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

export class PrismaOfferHuntMapper {
  static huntToDomain(raw: PrismaOfferHunt): OfferHunt {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      provider: providerOf(raw.provider),
      name: raw.name,
      status: raw.status,
      pauseReason: raw.pauseReason,
      sort: SORT_OF_CODE.get(raw.sort) ?? 'RECOMMENDED',
      categoryId: raw.categoryId,
      commissionBand: raw.commissionBand === null ? null : (BAND_OF_CODE.get(raw.commissionBand) ?? null),
      keyword: raw.keyword,
      sourceOptions: sourceOptionsOf(raw.sourceOptions),
      filters: {
        minPriceCents: raw.minPriceCents,
        maxPriceCents: raw.maxPriceCents,
        minDiscountPct: raw.minDiscountPercent,
        minCommissionPct: num(raw.minCommissionPercent),
        commissionOperator: raw.minCommissionPercent === null ? null : (raw.commissionOperator ?? 'GTE'),
        minCommissionCents: raw.minCommissionCents,
        minRating: num(raw.minRating),
        minSales: raw.minSalesBucket,
        minReviews: raw.minReviewsBucket,
        onlyWithExtra: raw.extraCommissionOnly,
        endsWithinDays: raw.endsWithinDays,
      },
      aiEnabled: raw.aiEnabled,
      aiConfigured: raw.aiConfigured,
      aiIntent: raw.aiIntent,
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
    if (d.provider !== undefined) out.provider = d.provider;
    if (d.sourceOptions !== undefined) out.sourceOptions = sourceOptionsToData(d.sourceOptions);
    if (d.aiIntent !== undefined) out.aiIntent = d.aiIntent;
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
      out.commissionOperator = f.minCommissionPct == null ? null : (f.commissionOperator ?? 'GTE');
      out.minCommissionCents = f.minCommissionCents ?? null;
      out.minRating = dec(f.minRating);
      out.minSalesBucket = f.minSales ?? null;
      out.minReviewsBucket = f.minReviews ?? null;
      out.extraCommissionOnly = f.onlyWithExtra === true;
      out.endsWithinDays = f.endsWithinDays ?? null;
    }
    for (const k of ['aiEnabled', 'aiConfigured', 'topN', 'repeatAfterDays', 'deliveryMode', 'intervalMinutes', 'windowStartMinute', 'windowEndMinute', 'weekdaysMask'] as const) {
      if (d[k] !== undefined) (out as Record<string, unknown>)[k] = d[k];
    }
    return out;
  }

  static runToDomain(raw: PrismaOfferHuntRun): OfferHuntRun {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      provider: providerOf(raw.provider),
      huntId: raw.huntId,
      trigger: raw.trigger,
      status: raw.status,
      seenCount: raw.seenCount,
      matchedCount: raw.matchedCount,
      chosenCount: raw.chosenCount,
      sentCount: raw.sentCount,
      aiUsed: raw.aiUsed,
      aiFallback: raw.aiFallback,
      rejectedBy: rejectionsOf(raw.rejectedBy),
      ranking: rankingOf(raw.ranking, providerOf(raw.provider)),
      errorCode: raw.errorCode,
      startedAt: raw.startedAt,
      finishedAt: raw.finishedAt,
    };
  }

  /** Linha da lista (sem a coluna `ranking`). */
  static runSummaryToDomain(raw: Omit<PrismaOfferHuntRun, 'ranking'>, hasRanking: boolean): OfferHuntRunSummary {
    const { ranking: _omit, ...run } = PrismaOfferHuntMapper.runToDomain({ ...raw, ranking: null });
    return { ...run, hasRanking };
  }

  static findToDomain(raw: PrismaOfferHuntFind): OfferHuntFind {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      huntId: raw.huntId,
      runId: raw.runId,
      provider: providerOf(raw.provider),
      // Linha gravada pelo código anterior (deploy em voo) só tem goodsId
      productId: raw.productId ?? raw.goodsId ?? '',
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
      commissionEstimated: raw.commissionEstimated,
      salesBucket: raw.salesBucket,
      reviewsBucket: raw.reviewsBucket,
      rating: num(raw.rating),
      score: raw.score,
      factors: factorsOf(raw.factors),
      aiReason: raw.aiReason,
      status: raw.status,
      failureReason: raw.failureReason,
      offerId: raw.offerId,
      resendCount: raw.resendCount,
      lastResentAt: raw.lastResentAt,
      resendInFlightUntil: raw.resendInFlightUntil,
      delivery: null,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  static snapshotToData(s: OfferHuntFindSnapshot) {
    return {
      provider: s.provider,
      productId: s.productId,
      // Coluna legada só da Shein
      goodsId: s.provider === 'SHEIN' ? s.productId : null,
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
      commissionEstimated: s.commissionEstimated,
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
