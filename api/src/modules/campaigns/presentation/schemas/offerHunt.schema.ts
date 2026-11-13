import { HUNT_COMMISSION_BANDS, HUNT_COMMISSION_OPERATORS, HUNT_REJECTION_KEYS, HUNT_SORTS } from '../../domain/hunter/HuntCandidate';
import {
  HUNT_FIND_DISPATCH_STATUSES, OFFER_HUNT_DELIVERY_MODES, OFFER_HUNT_FIND_STATUSES, OFFER_HUNT_PAUSE_REASONS, OFFER_HUNT_RUN_STATUSES, OFFER_HUNT_RUN_TRIGGERS,
  OFFER_HUNT_STATUSES,
} from '../../domain/hunter/OfferHunt';
import { HUNTER_LIMITS as L } from '../../domain/services/hunter/hunterLimits';
import { MINUTES_PER_DAY, ALL_WEEKDAYS_MASK } from '../../domain/services/postingWindow';

// Validação grossa no schema; a fina (faixas cruzadas, janela vazia, caractere de controle) é 422 com o campo, no use case.

const id = { type: 'string', minLength: 1, maxLength: 64 } as const;
const nullableNumber = { type: ['number', 'null'], minimum: 0, maximum: 1_000_000_000 } as const;
const nullableInt = { type: ['integer', 'null'], minimum: 0, maximum: 1_000_000_000 } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const nullableInteger = { type: ['integer', 'null'] } as const;
const minute = { type: 'integer', minimum: 0, maximum: MINUTES_PER_DAY } as const;

// ── Entrada ──────────────────────────────────────────────────────────────────

export const huntIdParamSchema = { type: 'object', required: ['id'], properties: { id }, additionalProperties: false } as const;
export const findIdParamSchema = { type: 'object', required: ['findId'], properties: { findId: id }, additionalProperties: false } as const;

/** Só o cursor opaco: tamanho da página é do servidor (`limit`/`offset` não existem aqui). */
export const pageQuerySchema = {
  type: 'object',
  properties: { cursor: { type: 'string', minLength: 1, maxLength: 1024 } },
  additionalProperties: false,
} as const;

const filtersSchema = {
  type: 'object',
  properties: {
    minPriceCents: nullableInt,
    maxPriceCents: nullableInt,
    minDiscountPct: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
    minCommissionPct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
    commissionOperator: { type: ['string', 'null'], enum: [...HUNT_COMMISSION_OPERATORS, null] },
    minCommissionCents: nullableInt,
    minRating: { type: ['number', 'null'], minimum: 0, maximum: 5 },
    minSales: nullableInt,
    minReviews: nullableInt,
    onlyWithExtra: { type: ['boolean', 'null'] },
    endsWithinDays: { type: ['integer', 'null'], minimum: 1, maximum: L.endsWithinDaysMax },
  },
  additionalProperties: false,
} as const;

const definitionProperties = {
  name: { type: 'string', minLength: 1, maxLength: L.nameMaxLength },
  sort: { type: 'string', enum: [...HUNT_SORTS] },
  categoryId: { type: ['string', 'null'], maxLength: 64 },
  commissionBand: { type: ['string', 'null'], enum: [...HUNT_COMMISSION_BANDS, null] },
  keyword: { type: ['string', 'null'], maxLength: L.keywordMaxLength },
  filters: filtersSchema,
  aiEnabled: { type: 'boolean' },
  topN: { type: 'integer', minimum: 1, maximum: L.topNMax },
  repeatAfterDays: { type: 'integer', minimum: L.repeatAfterDaysMin, maximum: L.repeatAfterDaysMax },
  deliveryMode: { type: 'string', enum: [...OFFER_HUNT_DELIVERY_MODES] },
  intervalMinutes: { type: 'integer', minimum: L.intervalMinutesMin, maximum: L.intervalMinutesMax },
  windowStartMinute: minute,
  windowEndMinute: minute,
  weekdaysMask: { type: 'integer', minimum: 1, maximum: ALL_WEEKDAYS_MASK },
} as const;

export const createHuntBodySchema = {
  type: 'object', required: ['name'], properties: definitionProperties, additionalProperties: false,
} as const;

export const updateHuntBodySchema = {
  type: 'object', minProperties: 1, properties: definitionProperties, additionalProperties: false,
} as const;

export const settingsBodySchema = {
  type: 'object',
  required: ['sessionId', 'conversationId'],
  properties: { sessionId: id, conversationId: id },
  additionalProperties: false,
} as const;

// ── Saída (envelope { success, data }) ───────────────────────────────────────

const envelope = (data: object) => ({ type: 'object', properties: { success: { type: 'boolean' }, data } });
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties });
const factors = { type: 'array', items: obj({ key: { type: 'string' }, points: { type: 'number' }, max: { type: 'number' } }) };
const dateTime = { type: 'string', format: 'date-time' } as const;
const nullableDateTime = { type: ['string', 'null'], format: 'date-time' } as const;

const huntSchema = obj({
  id: { type: 'string' },
  name: { type: 'string' },
  status: { type: 'string', enum: [...OFFER_HUNT_STATUSES] },
  pauseReason: { type: ['string', 'null'], enum: [...OFFER_HUNT_PAUSE_REASONS, null] },
  sort: { type: 'string' },
  categoryId: nullableStr,
  commissionBand: nullableStr,
  keyword: nullableStr,
  filters: obj({
    minPriceCents: nullableInteger, maxPriceCents: nullableInteger, minDiscountPct: nullableNumber,
    minCommissionPct: nullableNumber, commissionOperator: nullableStr, minCommissionCents: nullableInteger, minRating: nullableNumber,
    minSales: nullableInteger, minReviews: nullableInteger, onlyWithExtra: { type: ['boolean', 'null'] },
    endsWithinDays: nullableInteger,
  }),
  aiEnabled: { type: 'boolean' },
  topN: { type: 'integer' },
  repeatAfterDays: { type: 'integer' },
  deliveryMode: { type: 'string' },
  intervalMinutes: { type: 'integer' },
  windowStartMinute: { type: 'integer' },
  windowEndMinute: { type: 'integer' },
  weekdaysMask: { type: 'integer' },
  nextRunAt: nullableDateTime,
  lastRunAt: nullableDateTime,
  consecutiveFailures: { type: 'integer' },
  createdAt: dateTime,
  updatedAt: dateTime,
});

/** Recusas por filtro local da execução (lista fechada de chaves); null = execução antiga ou sem fonte. */
const rejectedBy = {
  type: ['object', 'null'],
  properties: Object.fromEntries(HUNT_REJECTION_KEYS.map((k) => [k, { type: 'integer' }])),
  additionalProperties: false,
} as const;

const rankingItemSchema = obj({
  goodsId: { type: 'string' }, title: nullableStr, imageUrl: nullableStr, priceCents: nullableInteger,
  discountPercent: { type: ['number', 'null'] }, commissionPercent: { type: ['number', 'null'] }, commissionCents: nullableInteger,
  returningCommissionPercent: { type: ['number', 'null'] }, returningCommissionCents: nullableInteger,
  extraCommissionCents: nullableInteger, salesBucket: nullableInteger, reviewsBucket: nullableInteger,
  rating: { type: ['number', 'null'] }, score: { type: 'number' }, factors, aiReason: nullableStr, chosen: { type: 'boolean' },
});

const runSchema = obj({
  id: { type: 'string' },
  huntId: nullableStr,
  trigger: { type: 'string', enum: [...OFFER_HUNT_RUN_TRIGGERS] },
  status: { type: 'string', enum: [...OFFER_HUNT_RUN_STATUSES] },
  errorCode: nullableStr,
  seenCount: { type: 'integer' },
  matchedCount: { type: 'integer' },
  chosenCount: { type: 'integer' },
  sentCount: { type: 'integer' },
  aiUsed: { type: 'boolean' },
  aiFallback: { type: 'boolean' },
  rejectedBy,
  /** null = execução antiga ou sem fonte. */
  ranking: { type: ['array', 'null'], items: rankingItemSchema },
  startedAt: dateTime,
  finishedAt: nullableDateTime,
});

const findSchema = obj({
  id: { type: 'string' },
  huntId: nullableStr,
  runId: nullableStr,
  status: { type: 'string', enum: [...OFFER_HUNT_FIND_STATUSES] },
  goodsId: { type: 'string' },
  title: { type: 'string' },
  imageUrl: nullableStr,
  priceCents: nullableInteger,
  originalPriceCents: nullableInteger,
  discountPercent: { type: ['number', 'null'] },
  commissionPercent: { type: ['number', 'null'] },
  commissionCents: nullableInteger,
  returningCommissionPercent: { type: ['number', 'null'] },
  returningCommissionCents: nullableInteger,
  extraCommissionCents: nullableInteger,
  salesBucket: nullableInteger,
  reviewsBucket: nullableInteger,
  rating: { type: ['number', 'null'] },
  score: { type: 'number' },
  factors,
  aiReason: nullableStr,
  failureReason: nullableStr,
  offerId: nullableStr,
  /** Status do disparo da oferta (QUEUED/SENDING/SENT/FAILED/SKIPPED/CANCELLED); null = sem oferta. */
  dispatchStatus: { type: ['string', 'null'], enum: [...HUNT_FIND_DISPATCH_STATUSES, null] },
  sentAt: nullableDateTime,
  destination: { type: ['object', 'null'], properties: { groupName: nullableStr, sessionName: nullableStr } },
  resendCount: { type: 'integer' },
  lastResentAt: nullableDateTime,
  createdAt: dateTime,
});

export const accessResponse = envelope(obj({ visible: { type: 'boolean' } }));
export const huntResponse = envelope(huntSchema);
export const huntListResponse = envelope({ type: 'array', items: huntSchema });
export const runsPageResponse = envelope(obj({ items: { type: 'array', items: runSchema }, nextCursor: nullableStr }));
export const findsPageResponse = envelope(obj({ items: { type: 'array', items: findSchema }, nextCursor: nullableStr }));
export const findResponse = envelope(findSchema);
export const approveFindResponse = envelope(obj({ find: findSchema, offerId: { type: 'string' } }));

export const runResultResponse = envelope(obj({
  runId: nullableStr,
  status: { type: 'string' },
  errorCode: nullableStr,
  seenCount: { type: 'integer' },
  matchedCount: { type: 'integer' },
  chosenCount: { type: 'integer' },
  sentCount: { type: 'integer' },
  aiUsed: { type: 'boolean' },
  aiFallback: { type: 'boolean' },
  rejectedBy,
  ranking: { type: 'array', items: rankingItemSchema },
  finds: { type: 'array', items: findSchema },
  remainingToday: { type: 'integer' },
  pausedReason: nullableStr,
}));

export const usageResponse = envelope(obj({
  used: { type: 'integer' }, limit: { type: 'integer' }, remaining: { type: 'integer' },
  runsToday: { type: 'integer' }, runsMax: { type: 'integer' },
}));

const localFiltersOut = obj(Object.fromEntries(Object.keys(filtersSchema.properties).map((k) => [k, { type: ['number', 'boolean', 'string', 'null'] }])));

export const optionsResponse = envelope(obj({
  categories: { type: 'array', items: obj({ categoryId: { type: 'string' }, name: { type: 'string' } }) },
  sourceStatus: { type: 'string' },
  sorts: { type: 'array', items: { type: 'string' } },
  commissionBands: { type: 'array', items: { type: 'string' } },
  presets: {
    type: 'array',
    items: obj({
      key: { type: 'string' },
      definition: obj({ source: obj({ sort: { type: 'string' }, commissionBand: { type: 'string' } }), local: localFiltersOut }),
    }),
  },
  limits: obj(Object.fromEntries([
    'huntsMax', 'topNMax', 'topNDefault', 'repeatAfterDaysMin', 'repeatAfterDaysMax', 'repeatAfterDaysDefault',
    'intervalMinutesMin', 'intervalMinutesMax', 'keywordMaxLength', 'nameMaxLength', 'endsWithinDaysMax',
  ].map((k) => [k, { type: 'integer' }]))),
  gates: obj(Object.fromEntries(['plan', 'hunterEntitlement', 'credential', 'riskAccepted', 'aiAvailable', 'destination'].map((k) => [k, { type: 'boolean' }]))),
}));

export const settingsResponse = envelope(obj({ sessionId: nullableStr, conversationId: nullableStr, valid: { type: 'boolean' }, groupName: nullableStr }));
