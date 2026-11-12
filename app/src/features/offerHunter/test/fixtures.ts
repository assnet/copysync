import type { Hunt, HuntFind, HuntOptions } from '../types';

export const huntOptions = (over: Partial<HuntOptions> = {}): HuntOptions => ({
  categories: [{ categoryId: 'c1', name: 'Vestidos' }],
  sourceStatus: 'OK',
  sorts: ['RECOMMENDED', 'BEST_SELLING'],
  commissionBands: ['BELOW_5', 'FROM_5_TO_10', 'FROM_10_TO_15', 'ABOVE_15', 'ANY'],
  presets: [
    { key: 'TOP_COMMISSION', definition: { source: { sort: 'RECOMMENDED', commissionBand: 'ABOVE_15' }, local: { minCommissionPct: 15 } } },
    { key: 'BEST_SELLERS', definition: { source: { sort: 'BEST_SELLING', commissionBand: 'ANY' }, local: { minSales: 100, minRating: 4 } } },
    { key: 'CUSTOM', definition: { source: { sort: 'RECOMMENDED', commissionBand: 'ANY' }, local: {} } },
  ],
  limits: {
    huntsMax: 5, topNMax: 5, topNDefault: 3, repeatAfterDaysMin: 1, repeatAfterDaysMax: 30, repeatAfterDaysDefault: 7,
    intervalMinutesMin: 30, intervalMinutesMax: 1440, keywordMaxLength: 10, nameMaxLength: 40, endsWithinDaysMax: 30,
  },
  gates: { plan: true, hunterEntitlement: true, credential: true, riskAccepted: true, aiAvailable: true, destination: true },
  ...over,
});

export const hunt = (over: Partial<Hunt> = {}): Hunt => ({
  id: 'h1', name: 'Moda', status: 'ACTIVE', pauseReason: null, sort: 'RECOMMENDED', categoryId: null, commissionBand: 'ANY',
  keyword: null,
  filters: {
    minPriceCents: null, maxPriceCents: null, minDiscountPct: null, minCommissionPct: null, minCommissionCents: null,
    minRating: null, minSales: null, minReviews: null, onlyWithExtra: null, endsWithinDays: null,
  },
  aiEnabled: false, topN: 2, repeatAfterDays: 7, deliveryMode: 'REVIEW', intervalMinutes: 60, windowStartMinute: 0,
  windowEndMinute: 1440, weekdaysMask: 127, nextRunAt: null, lastRunAt: null, consecutiveFailures: 0,
  createdAt: '2026-11-12T10:00:00.000Z', updatedAt: '2026-11-12T10:00:00.000Z', ...over,
});

export const huntFind = (id: string, over: Partial<HuntFind> = {}): HuntFind => ({
  id, huntId: 'h1', runId: 'r1', status: 'PENDING_REVIEW', goodsId: `g${id}`, title: `Item ${id}`, priceCents: 1990,
  originalPriceCents: 3990, discountPercent: 50, commissionPercent: 10, commissionCents: 199,
  returningCommissionPercent: 5, returningCommissionCents: 99, extraCommissionCents: null, salesBucket: 100,
  reviewsBucket: null, rating: 4.5, score: 72.5, factors: [{ key: 'commission', points: 20, max: 30 }], aiReason: null,
  failureReason: null, offerId: null, createdAt: '2026-11-12T10:00:00.000Z', ...over,
});
