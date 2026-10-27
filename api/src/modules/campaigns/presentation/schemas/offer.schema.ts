import { AFFILIATE_PROVIDERS } from '../../../integrations/domain/enums/AffiliateProvider';
import { OFFER_STATUSES } from '../../domain/enums/OfferStatus';
import { OFFER_DISPATCH_STATUSES } from '../../domain/enums/OfferDispatchStatus';
import { OFFER_AUDIENCES } from '../../domain/enums/OfferAudience';
import { OFFER_COUPON_MAX } from '../../application/use-cases/offerCoupon';
import {
  OFFER_GROUPS_HARD_MAX,
  OFFER_INTERVAL_MAX_SECONDS,
  OFFER_INTERVAL_MIN_SECONDS,
  OFFER_SESSIONS_HARD_MAX,
} from '../../application/use-cases/OfferGeneratorConfigUseCases';
import { OFFER_TYPING_SECONDS_MIN, OFFER_TYPING_SECONDS_MAX } from '../../domain/offerTyping';
import { OFFER_DISPATCH_ORDERS } from '../../domain/entities/OfferGeneratorConfig';

/** Mesmo formato do `uploadId` gerado pelo store (`randomUUID` v4, minúsculo). */
const UPLOAD_ID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

const priceCents = { type: ['integer', 'null'], minimum: 0, maximum: 1_000_000_000 } as const;
const audience = { type: 'string', enum: [...OFFER_AUDIENCES] } as const;
/** Formato fino (caracteres) é 422 `coupon` no use case. */
const coupon = { type: ['string', 'null'], maxLength: OFFER_COUPON_MAX } as const;
const intervalSeconds = { type: 'integer', minimum: OFFER_INTERVAL_MIN_SECONDS, maximum: OFFER_INTERVAL_MAX_SECONDS } as const;

// ── Entrada ──────────────────────────────────────────────────────────────────

export const offerIdParamSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

export const generateOfferBodySchema = {
  type: 'object',
  required: ['url'],
  properties: { url: { type: 'string', minLength: 1, maxLength: 2048 }, coupon, audience },
  additionalProperties: false,
} as const;

/** Teto grosso; limite fino (título, texto vazio) é 422 com o campo, no use case. */
export const updateOfferBodySchema = {
  type: 'object',
  properties: {
    title: { type: ['string', 'null'], maxLength: 512 },
    priceCents,
    originalPriceCents: priceCents,
    text: { type: 'string', maxLength: 4096 },
    imageUploadId: { type: 'string', pattern: UPLOAD_ID_PATTERN },
    coupon,
    audience,
    mentionAll: { type: 'boolean' },
    simulateTyping: { type: 'boolean' },
    typingSeconds: { type: 'integer', minimum: OFFER_TYPING_SECONDS_MIN, maximum: OFFER_TYPING_SECONDS_MAX },
  },
  additionalProperties: false,
} as const;

export const regenerateOfferBodySchema = {
  type: ['object', 'null'],
  properties: { audience },
  additionalProperties: false,
} as const;

/** Intervalo: 60–3600 s (1–60 min) no schema; `min ≤ max` e plano no use case. */
export const saveConfigBodySchema = {
  type: 'object',
  required: ['sessionIds', 'intervalMinSeconds', 'intervalMaxSeconds', 'dispatchOrder', 'conversationIds'],
  properties: {
    sessionIds: {
      type: 'array',
      minItems: 1,
      maxItems: OFFER_SESSIONS_HARD_MAX,
      items: { type: 'string', minLength: 1, maxLength: 64 },
    },
    intervalMinSeconds: intervalSeconds,
    intervalMaxSeconds: intervalSeconds,
    dispatchOrder: { type: 'string', enum: [...OFFER_DISPATCH_ORDERS] },
    conversationIds: {
      type: 'array',
      maxItems: OFFER_GROUPS_HARD_MAX,
      items: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
  additionalProperties: false,
} as const;

// ── Saída (envelope { success, data }) ───────────────────────────────────────
// Lista fechada de campos: o serializador descarta o que não estiver aqui (nunca credencial).

const nullableString = { type: ['string', 'null'] } as const;

const offerDispatchSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    conversationId: { type: 'string' },
    status: { type: 'string', enum: [...OFFER_DISPATCH_STATUSES] },
    notBefore: { type: 'string', format: 'date-time' },
    chatMessageId: nullableString,
    failureReason: nullableString,
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const offerSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    provider: { type: 'string', enum: [...AFFILIATE_PROVIDERS] },
    sourceUrl: { type: 'string' },
    productRef: nullableString,
    title: nullableString,
    priceCents: { type: ['integer', 'null'] },
    originalPriceCents: { type: ['integer', 'null'] },
    imageUrl: nullableString,
    affiliateUrl: { type: 'string' },
    attributionVerified: { type: 'boolean' },
    text: { type: 'string' },
    textEdited: { type: 'boolean' },
    coupon: nullableString,
    audience,
    mentionAll: { type: 'boolean' },
    simulateTyping: { type: 'boolean' },
    typingSeconds: { type: 'integer' },
    status: { type: 'string', enum: [...OFFER_STATUSES] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    dispatches: { type: 'array', items: offerDispatchSchema },
  },
} as const;

const configGroupSchema = {
  type: 'object',
  properties: { id: { type: 'string' }, title: nullableString, avatarUrl: nullableString, sessionId: nullableString },
} as const;

const aiFlags = { aiFallback: { type: 'boolean' }, aiErrorCode: { type: 'string' } } as const;

const envelope = (data: object) => ({
  type: 'object',
  properties: { success: { type: 'boolean' }, data },
});

export const generateOfferResponse = envelope({
  type: 'object',
  properties: { offer: offerSchema, needsManualData: { type: 'boolean' }, ...aiFlags },
});

export const regenerateOfferResponse = envelope({
  type: 'object',
  properties: { offer: offerSchema, ...aiFlags },
});

export const offerResponse = envelope(offerSchema);

export const sendOfferResponse = envelope({
  type: 'object',
  properties: { offer: offerSchema, dispatches: { type: 'array', items: offerDispatchSchema } },
});

export const offerUsageResponse = envelope({
  type: 'object',
  properties: { used: { type: 'integer' }, limit: { type: ['integer', 'null'] } },
});

export const offerConfigResponse = envelope({
  type: 'object',
  properties: {
    sessionIds: { type: 'array', items: { type: 'string' } },
    intervalMinSeconds: { type: 'integer' },
    intervalMaxSeconds: { type: 'integer' },
    dispatchOrder: { type: 'string', enum: [...OFFER_DISPATCH_ORDERS] },
    groups: { type: 'array', items: configGroupSchema },
    groupLimit: { type: ['number', 'null'] },
    sessionLimit: { type: ['number', 'null'] },
    configured: { type: 'boolean' },
  },
});

// Grupos da sessão (todos do WhatsApp, não só os com mensagem)
const GROUP_JID_PATTERN = '^[0-9]{5,40}(-[0-9]{5,20})?$';

export const sessionGroupsQuerySchema = {
  type: 'object',
  required: ['sessionId'],
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', minLength: 1, maxLength: 64 },
    search: { type: 'string', maxLength: 100 },
  },
} as const;

export const sessionGroupsResponse = envelope({
  type: 'object',
  properties: {
    partial: { type: 'boolean' },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          groupJid: { type: 'string' },
          title: nullableString,
          avatarUrl: nullableString,
          conversationId: nullableString,
        },
      },
    },
  },
});

export const ensureSessionGroupBodySchema = {
  type: 'object',
  required: ['sessionId', 'groupJid'],
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', minLength: 1, maxLength: 64 },
    groupJid: { type: 'string', pattern: GROUP_JID_PATTERN },
  },
} as const;

export const ensureSessionGroupResponse = envelope({
  type: 'object',
  properties: { conversationId: { type: 'string' }, title: nullableString },
});
