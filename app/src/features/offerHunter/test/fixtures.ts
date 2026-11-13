import type { Hunt, HuntFind, HuntGates, HuntOptions, HuntProviderState } from '../types';
import { fallbackCapabilities } from '../providers';

export const OPEN_GATES: HuntGates = { plan: true, hunterEntitlement: true, credential: true, riskAccepted: true, aiAvailable: true, destination: true };

export const huntOptions = (over: Partial<HuntOptions> = {}): HuntOptions => ({
  provider: 'SHEIN',
  capabilities: fallbackCapabilities('SHEIN'),
  categories: [{ categoryId: 'c1', name: 'Vestidos' }],
  sourceStatus: 'OK',
  sorts: ['RECOMMENDED', 'BEST_SELLING'],
  commissionBands: [],
  presets: [
    { key: 'TOP_COMMISSION', definition: { source: { sort: 'RECOMMENDED', commissionBand: 'ANY' }, local: { minCommissionPct: 15, commissionOperator: 'GTE' } } },
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

/** Opções do Mercado Livre: ordenação da fonte, sem avaliações/prazo, predefinições filtradas como na API. */
export const mlOptions = (over: Partial<HuntOptions> = {}): HuntOptions => huntOptions({
  provider: 'MERCADO_LIVRE',
  capabilities: fallbackCapabilities('MERCADO_LIVRE'),
  categories: [{ categoryId: 'MLB1', name: 'Calçados' }],
  sorts: ['relevance', 'lowest_price', 'highest_price'],
  presets: [
    { key: 'TOP_COMMISSION', definition: { source: { sort: 'relevance', commissionBand: 'ANY' }, local: { minCommissionPct: 15, commissionOperator: 'GTE' } } },
    { key: 'CUSTOM', definition: { source: { sort: 'relevance', commissionBand: 'ANY' }, local: {} } },
  ],
  ...over,
});

export const providerState = (provider: HuntProviderState['provider'], over: Partial<HuntProviderState> = {}, gates: Partial<HuntGates> = {}): HuntProviderState => ({
  provider, credentialState: 'OK', gates: { ...OPEN_GATES, ...gates }, ...over,
});

export const hunt = (over: Partial<Hunt> = {}): Hunt => ({
  id: 'h1', provider: 'SHEIN', sourceOptions: null, aiConfigured: false, aiIntent: null, name: 'Moda', status: 'ACTIVE', pauseReason: null, sort: 'RECOMMENDED', categoryId: null, commissionBand: 'ANY',
  keyword: null,
  filters: {
    minPriceCents: null, maxPriceCents: null, minDiscountPct: null, minCommissionPct: null, commissionOperator: null, minCommissionCents: null,
    minRating: null, minSales: null, minReviews: null, onlyWithExtra: null, endsWithinDays: null,
  },
  aiEnabled: false, topN: 2, repeatAfterDays: 7, deliveryMode: 'REVIEW', intervalMinutes: 60, windowStartMinute: 0,
  windowEndMinute: 1440, weekdaysMask: 127, nextRunAt: null, lastRunAt: null, consecutiveFailures: 0,
  createdAt: '2026-11-12T10:00:00.000Z', updatedAt: '2026-11-12T10:00:00.000Z', ...over,
});

export const huntFind = (id: string, over: Partial<HuntFind> = {}): HuntFind => ({
  id, huntId: 'h1', runId: 'r1', status: 'PENDING_REVIEW', provider: 'SHEIN', productId: `g${id}`, commissionEstimated: false, goodsId: `g${id}`, title: `Item ${id}`, imageUrl: null, priceCents: 1990,
  originalPriceCents: 3990, discountPercent: 50, commissionPercent: 10, commissionCents: 199,
  returningCommissionPercent: 5, returningCommissionCents: 99, extraCommissionCents: null, salesBucket: 100,
  reviewsBucket: null, rating: 4.5, score: 72.5, factors: [{ key: 'commission', points: 20, max: 30 }], aiReason: null,
  failureReason: null, offerId: null, dispatchStatus: null, sentAt: null, destination: null, resendCount: 0, lastResentAt: null,
  createdAt: '2026-11-12T10:00:00.000Z', ...over,
});
