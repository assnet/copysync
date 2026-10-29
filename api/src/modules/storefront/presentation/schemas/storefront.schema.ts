import { StorefrontOfferStatus, StorefrontStatus } from '../../domain/enums/StorefrontEnums';
import { AFFILIATE_PROVIDERS } from '../../../integrations/domain/enums/AffiliateProvider';
import { STOREFRONT_CATEGORY_KEYS } from '../../domain/services/storefrontCategories';
import {
  STOREFRONT_MAX_OFFERS,
  STOREFRONT_NAME_MAX_LENGTH,
  STOREFRONT_OFFER_TITLE_MAX_LENGTH,
  STOREFRONT_SUBTITLE_MAX_LENGTH,
} from '../../domain/services/storefrontRules';

/*
 * Schemas fechados (`additionalProperties: false`) na entrada e na saída. Aqui só tipo e teto: a
 * regra fina (nome 2–60, `#RRGGBB`, categorias do catálogo, slug) é do use case, com código
 * próprio (VALIDATION_ERROR com `meta.field`, LINK_SLUG_INVALID...). A prévia nunca recusa: só teto.
 */
const id = { type: 'string', minLength: 1, maxLength: 64 } as const;
const slug = { type: 'string', minLength: 1, maxLength: 63 } as const;
/** Teto folgado: o use case corta/valida e devolve o campo que falhou. */
const text = (max: number) => ({ type: 'string', maxLength: max * 2 }) as const;
const color = { type: 'string', maxLength: 16 } as const;
const categoryKeys = { type: 'array', maxItems: STOREFRONT_CATEGORY_KEYS.length * 2, items: { type: 'string', maxLength: 64 } } as const;
const offerCategory = { type: ['string', 'null'], maxLength: 64 } as const;
const priceCents = { type: ['integer', 'null'], minimum: 0, maximum: 1_000_000_000 } as const;
const offerStatus = { type: 'string', enum: Object.values(StorefrontOfferStatus) } as const;
const imageKind = { type: 'string', enum: ['avatar', 'cover'] } as const;
const nullableString = { type: ['string', 'null'] } as const;
const nullableDate = { type: ['string', 'null'], format: 'date-time' } as const;
const date = { type: 'string', format: 'date-time' } as const;
/** Mesmo formato do `uploadId` gerado pelo store (`randomUUID` v4, minúsculo). */
const uploadId = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' } as const;

const envelope = (data: object) => ({
  type: 'object',
  additionalProperties: false,
  properties: { success: { type: 'boolean' }, data },
});

// ── Params / query ───────────────────────────────────────────────────────────

export const offerIdParamSchema = {
  type: 'object',
  required: ['id'],
  properties: { id },
} as const;

export const imageKindParamSchema = {
  type: 'object',
  required: ['kind'],
  properties: { kind: imageKind },
} as const;

export const slugAvailabilityQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['slug'],
  properties: { slug, domainId: id },
} as const;

// ── Corpo ────────────────────────────────────────────────────────────────────

export const saveStorefrontBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['domainId', 'slug', 'title', 'colorPrimary', 'colorBackground', 'colorCard', 'categories'],
  properties: {
    domainId: id,
    slug,
    title: text(STOREFRONT_NAME_MAX_LENGTH),
    subtitle: { type: ['string', 'null'], maxLength: STOREFRONT_SUBTITLE_MAX_LENGTH * 2 },
    colorPrimary: color,
    colorBackground: color,
    colorCard: color,
    categories: categoryKeys,
  },
} as const;

export const setImageBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['uploadId'],
  properties: { uploadId },
} as const;

export const previewBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'colorPrimary', 'colorBackground', 'colorCard', 'categories'],
  properties: {
    title: text(STOREFRONT_NAME_MAX_LENGTH),
    subtitle: { type: ['string', 'null'], maxLength: STOREFRONT_SUBTITLE_MAX_LENGTH * 2 },
    colorPrimary: color,
    colorBackground: color,
    colorCard: color,
    categories: categoryKeys,
    slug,
    domainId: id,
    viewport: { type: 'string', enum: ['mobile', 'desktop'] },
  },
} as const;

export const extractOfferBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string', minLength: 1, maxLength: 2048 },
    category: offerCategory,
  },
} as const;

export const updateOfferBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    title: text(STOREFRONT_OFFER_TITLE_MAX_LENGTH),
    priceCents,
    originalPriceCents: priceCents,
    category: offerCategory,
  },
} as const;

export const offerStatusBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: offerStatus },
} as const;

export const reorderOffersBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'ids'],
  properties: {
    status: offerStatus,
    ids: { type: 'array', maxItems: STOREFRONT_MAX_OFFERS, items: id },
  },
} as const;

// ── Resposta ─────────────────────────────────────────────────────────────────

const offerItem = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    status: offerStatus,
    position: { type: 'integer' },
    provider: { type: 'string', enum: [...AFFILIATE_PROVIDERS] },
    sourceUrl: { type: 'string' },
    affiliateUrl: { type: 'string' },
    attributionVerified: { type: 'boolean' },
    title: { type: 'string' },
    priceCents,
    originalPriceCents: priceCents,
    imageUrl: nullableString,
    category: nullableString,
    publishedAt: nullableDate,
    createdAt: date,
    updatedAt: date,
  },
} as const;

const storefrontItem = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    subtitle: nullableString,
    avatarUrl: nullableString,
    coverUrl: nullableString,
    colorPrimary: { type: 'string' },
    colorBackground: { type: 'string' },
    colorCard: { type: 'string' },
    categories: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: Object.values(StorefrontStatus) },
    /** null = endereço ausente (janela inconsistente); a página não é servida. */
    domainId: nullableString,
    slug: nullableString,
    createdAt: date,
    updatedAt: date,
  },
} as const;

const keyLabel = {
  type: 'object',
  additionalProperties: false,
  properties: { key: { type: 'string' }, label: { type: 'string' } },
} as const;

export const storefrontOverviewResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: {
    storefront: { anyOf: [storefrontItem, { type: 'null' }] },
    publicUrl: nullableString,
    offers: {
      type: 'object',
      additionalProperties: false,
      properties: {
        drafts: { type: 'array', items: offerItem },
        published: { type: 'array', items: offerItem },
      },
    },
    categories: { type: 'array', items: keyLabel },
    subtitleSuggestions: { type: 'array', items: { type: 'string' } },
    domains: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, hostname: { type: 'string' } },
      },
    },
  },
});

export const storefrontResponse = envelope(storefrontItem);

export const slugAvailabilityResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['INVALID', 'RESERVED', 'PREMIUM', 'TAKEN', 'OWNED', 'AVAILABLE'] },
    slug: { type: 'string' },
    reservedReason: { type: 'string', enum: ['NAME', 'RECENT_RELEASE'] },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
});

export const imageResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: { url: { type: 'string' } },
});

export const previewResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: { html: { type: 'string' } },
});

export const offerResponse = envelope(offerItem);
