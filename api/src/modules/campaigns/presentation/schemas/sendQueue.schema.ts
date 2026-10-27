import { OFFER_DISPATCH_STATUSES } from '../../domain/enums/OfferDispatchStatus';
import { OFFER_ORIGINS } from '../../domain/enums/OfferOrigin';
import { OFFER_STATUSES } from '../../domain/enums/OfferStatus';

export const sendQueueQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { sessionId: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

const nullableString = { type: ['string', 'null'] } as const;
const dateTime = { type: 'string', format: 'date-time' } as const;

// Lista fechada: o serializador descarta o que não estiver aqui.
const itemSchema = {
  type: 'object',
  properties: {
    dispatchId: { type: 'string' },
    offerId: { type: 'string' },
    origin: { type: 'string', enum: [...OFFER_ORIGINS] },
    offerStatus: { type: 'string', enum: [...OFFER_STATUSES] },
    title: nullableString,
    textPreview: { type: 'string' },
    imageUrl: nullableString,
    coupon: nullableString,
    conversationId: { type: 'string' },
    groupName: nullableString,
    groupAvatarUrl: nullableString,
    status: { type: 'string', enum: [...OFFER_DISPATCH_STATUSES] },
    notBefore: dateTime,
    claimedAt: { type: ['string', 'null'], format: 'date-time' },
    updatedAt: dateTime,
    failureReason: nullableString,
  },
} as const;

const count = { type: 'integer', minimum: 0 } as const;

const sessionSchema = {
  type: 'object',
  properties: {
    sessionId: nullableString,
    name: nullableString,
    status: nullableString,
    running: { anyOf: [itemSchema, { type: 'null' }] },
    waiting: { type: 'array', items: itemSchema },
    recent: { type: 'array', items: itemSchema },
    counts: {
      type: 'object',
      properties: { waiting: count, paused: count, sentToday: count, failedToday: count, skippedToday: count },
    },
  },
} as const;

export const sendQueueResponse = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      properties: { serverTime: dateTime, sessions: { type: 'array', items: sessionSchema } },
    },
  },
} as const;
