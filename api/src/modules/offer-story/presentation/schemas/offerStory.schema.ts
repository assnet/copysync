import { OFFER_STORY_DISCOUNT_MAX, OFFER_STORY_DISCOUNT_MIN, OFFER_STORY_WARNINGS } from '../../domain/offerStoryRules';
import { AFFILIATE_PROVIDERS } from '../../../integrations/domain/enums/AffiliateProvider';

/*
 * Schemas fechados (`additionalProperties: false`). Aqui só tipo e teto: o código do cupom tem teto
 * folgado (60) e a regra fina (≤ 20, charset) é do use case (422 OFFER_INVALID_INPUT, `field: coupon`).
 * `discountPercent` sem `code` é barrado aqui (`required`).
 */
const envelope = (data: object) => ({
  type: 'object',
  additionalProperties: false,
  properties: { success: { type: 'boolean' }, data },
});
const nullableCents = { type: ['integer', 'null'] } as const;

export const renderOfferStoryBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['templateId', 'url'],
  properties: {
    templateId: { type: 'string', minLength: 1, maxLength: 40 },
    url: { type: 'string', minLength: 1, maxLength: 2048 },
    coupon: {
      type: 'object',
      additionalProperties: false,
      required: ['code'],
      properties: {
        code: { type: 'string', minLength: 1, maxLength: 60 },
        discountPercent: { type: 'integer', minimum: OFFER_STORY_DISCOUNT_MIN, maximum: OFFER_STORY_DISCOUNT_MAX },
      },
    },
  },
} as const;

export const offerStoryTemplatesResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: {
    templates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    },
  },
});

export const renderOfferStoryResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: {
    image: { type: 'string' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    templateId: { type: 'string' },
    headline: { type: 'string' },
    provider: { type: 'string', enum: [...AFFILIATE_PROVIDERS] },
    affiliateUrl: { type: 'string' },
    attributionVerified: { type: 'boolean' },
    price: {
      type: 'object',
      additionalProperties: false,
      properties: { fromCents: nullableCents, toCents: nullableCents },
    },
    coupon: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: { code: { type: 'string' }, discountPercent: nullableCents },
    },
    warnings: { type: 'array', items: { type: 'string', enum: [...OFFER_STORY_WARNINGS] } },
  },
});
