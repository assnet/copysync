import {
  REDIRECT_NOTE_MAX_LENGTH,
  REDIRECT_SLUG_MAX_LENGTH,
  REDIRECT_URL_MAX_LENGTH,
} from '../../domain/services/redirectLinkRules';

/*
 * Schemas fechados. Formato fino de slug, destino (https, sem credencial, sem loop) e nota é
 * validado no use case (`REDIRECT_LINK_INVALID` com `meta.field`); aqui só tipo e teto.
 */
const id = { type: 'string', minLength: 1, maxLength: 64 } as const;
const slug = { type: 'string', minLength: 1, maxLength: REDIRECT_SLUG_MAX_LENGTH } as const;
const url = { type: 'string', minLength: 1, maxLength: REDIRECT_URL_MAX_LENGTH } as const;
const nullableUrl = { type: ['string', 'null'], maxLength: REDIRECT_URL_MAX_LENGTH } as const;
const percentA = { type: 'integer', minimum: 0, maximum: 100 } as const;
const note = { type: ['string', 'null'], maxLength: REDIRECT_NOTE_MAX_LENGTH } as const;

const envelope = (data: object) => ({
  type: 'object',
  additionalProperties: false,
  properties: { success: { type: 'boolean' }, data },
});

export const redirectLinkIdParamSchema = { type: 'object', required: ['id'], properties: { id } } as const;
export const redirectSlugParamSchema = { type: 'object', required: ['slug'], properties: { slug } } as const;

export const createRedirectLinkBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'urlA'],
  properties: { slug, urlA: url, urlB: nullableUrl, percentA, isActive: { type: 'boolean' }, note },
} as const;

/** Parcial. `urlB: null` remove B (volta a 100% A); `note: null` remove a nota. */
export const updateRedirectLinkBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: { slug, urlA: url, urlB: nullableUrl, percentA, isActive: { type: 'boolean' }, note },
} as const;

const redirectLinkData = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    slug: { type: 'string' },
    urlA: { type: 'string' },
    urlB: { type: ['string', 'null'] },
    percentA: { type: 'integer' },
    isActive: { type: 'boolean' },
    hitsA: { type: 'integer' },
    hitsB: { type: 'integer' },
    hitsTotal: { type: 'integer' },
    note: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const redirectLinkResponse = envelope(redirectLinkData);
export const redirectLinkListResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: { items: { type: 'array', items: redirectLinkData } },
});
export const resolvedRedirectResponse = envelope({
  type: 'object',
  additionalProperties: false,
  properties: { url: { type: 'string' } },
});
