import { AFFILIATE_PROVIDERS } from '../../../integrations/domain/enums/AffiliateProvider';
import { OFFER_STATUSES } from '../../domain/enums/OfferStatus';
import { OFFER_DISPATCH_STATUSES } from '../../domain/enums/OfferDispatchStatus';
import { OFFER_DESTINATIONS_MAX } from '../../application/use-cases/ReplaceOfferDestinationsUseCase';

/** Mesmo formato do `uploadId` gerado pelo store (`randomUUID` v4, minúsculo). */
const UPLOAD_ID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

const priceCents = { type: ['integer', 'null'], minimum: 0, maximum: 1_000_000_000 } as const;

// ── Entrada ──────────────────────────────────────────────────────────────────

export const offerIdParamSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

export const generateOfferBodySchema = {
  type: 'object',
  required: ['url'],
  properties: { url: { type: 'string', minLength: 1, maxLength: 2048 } },
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
  },
  additionalProperties: false,
} as const;

export const replaceDestinationsBodySchema = {
  type: 'object',
  required: ['conversationIds'],
  properties: {
    conversationIds: {
      type: 'array',
      maxItems: OFFER_DESTINATIONS_MAX,
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
    status: { type: 'string', enum: [...OFFER_STATUSES] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    dispatches: { type: 'array', items: offerDispatchSchema },
  },
} as const;

const destinationSchema = {
  type: 'object',
  properties: {
    conversationId: { type: 'string' },
    title: nullableString,
    isGroup: { type: 'boolean' },
    sessionId: nullableString,
    sessionName: nullableString,
  },
} as const;

const envelope = (data: object) => ({
  type: 'object',
  properties: { success: { type: 'boolean' }, data },
});

export const generateOfferResponse = envelope({
  type: 'object',
  properties: { offer: offerSchema, needsManualData: { type: 'boolean' } },
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

export const offerDestinationsResponse = envelope({ type: 'array', items: destinationSchema });
