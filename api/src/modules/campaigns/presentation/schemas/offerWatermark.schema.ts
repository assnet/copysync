import {
  OFFER_WATERMARK_KINDS,
  OFFER_WATERMARK_POSITIONS,
  OFFER_WATERMARK_SIZES,
} from '../../domain/services/offerWatermarkRules';

/*
 * Schemas fechados na entrada e na saída. Na entrada só tipo e teto folgado: a regra (texto 1–32 numa
 * linha, opacidade 20–100, enums) é do use case e volta como 422 `OFFER_WATERMARK_INVALID_INPUT` com
 * `meta.field`. A saída nunca tem a chave do storage (`imageKey`), só `imageUrl`.
 */
const envelope = (data: object) => ({
  type: 'object',
  additionalProperties: false,
  properties: { success: { type: 'boolean' }, data },
});

/** Mesmo formato do `uploadId` gerado pelo store (`randomUUID` v4, minúsculo). */
const uploadId = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' } as const;

export const updateOfferWatermarkBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
    kind: { type: 'string', maxLength: 32 },
    text: { type: ['string', 'null'], maxLength: 256 },
    position: { type: 'string', maxLength: 32 },
    size: { type: 'string', maxLength: 32 },
    opacity: { type: 'number' },
  },
} as const;

export const setOfferWatermarkImageBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['uploadId'],
  properties: { uploadId },
} as const;

const watermarkItem = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
    kind: { type: 'string', enum: [...OFFER_WATERMARK_KINDS] },
    text: { type: ['string', 'null'] },
    position: { type: 'string', enum: [...OFFER_WATERMARK_POSITIONS] },
    size: { type: 'string', enum: [...OFFER_WATERMARK_SIZES] },
    opacity: { type: 'integer' },
    imageUrl: { type: ['string', 'null'] },
    canEdit: { type: 'boolean' },
    updatedAt: { type: ['string', 'null'], format: 'date-time' },
  },
} as const;

export const offerWatermarkResponse = envelope(watermarkItem);

export const offerWatermarkAccessResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: { visible: { type: 'boolean' } },
});
