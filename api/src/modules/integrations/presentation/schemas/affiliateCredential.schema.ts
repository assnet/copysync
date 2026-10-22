import { AFFILIATE_PROVIDERS } from '../../domain/enums/AffiliateProvider';
import { AFFILIATE_CREDENTIAL_STATUSES } from '../../domain/enums/AffiliateCredentialStatus';

/** Registrado em `app.ts` via `addSchema`. Nenhum campo secreto existe aqui. */
export const affiliateCredentialItemSchema = {
  $id: 'AffiliateCredentialItem',
  type: 'object',
  properties: {
    provider: { type: 'string', enum: [...AFFILIATE_PROVIDERS] },
    status: { type: 'string', enum: [...AFFILIATE_CREDENTIAL_STATUSES] },
    publicIdentifier: { type: ['string', 'null'] },
    publicIdentifierMasked: { type: ['string', 'null'] },
    hasSecret: { type: 'boolean' },
    hasSession: { type: 'boolean' },
    sessionSyncedAt: { type: ['string', 'null'], format: 'date-time' },
    lastValidatedAt: { type: ['string', 'null'], format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const affiliateProviderParamSchema = {
  type: 'object',
  required: ['provider'],
  properties: {
    provider: { type: 'string', enum: [...AFFILIATE_PROVIDERS] },
  },
} as const;

/** Tamanho fino é validado no domínio (422 com o campo), não aqui. */
export const upsertAffiliateCredentialBodySchema = {
  type: 'object',
  required: ['publicIdentifier'],
  properties: {
    publicIdentifier: { type: 'string', maxLength: 256 },
    secret: { type: 'string', maxLength: 512 },
  },
  additionalProperties: false,
} as const;

export const setAffiliateCredentialStatusBodySchema = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: [...AFFILIATE_CREDENTIAL_STATUSES] },
  },
  additionalProperties: false,
} as const;

/**
 * Contrato da extensão (`extension/src/contract/api.ts`). `affiliateTag` sem `maxLength`: tag
 * ruim é descartada no domínio, nunca derruba a renovação da sessão com 400.
 */
export const upsertAffiliateSessionBodySchema = {
  type: 'object',
  required: ['sessionToken', 'csrfToken', 'capturedAt'],
  properties: {
    sessionToken: { type: 'string', minLength: 1, maxLength: 8192 },
    csrfToken: { type: 'string', minLength: 1, maxLength: 8192 },
    affiliateTag: { type: 'string' },
    capturedAt: { type: 'string', maxLength: 64 },
  },
  additionalProperties: false,
} as const;

const envelope = (data: object) => ({
  type: 'object',
  properties: { success: { type: 'boolean' }, data },
});

export const affiliateCredentialItemResponse = envelope({ $ref: 'AffiliateCredentialItem#' });

export const affiliateCredentialListResponse = envelope({
  type: 'object',
  properties: { items: { type: 'array', items: { $ref: 'AffiliateCredentialItem#' } } },
});

export const affiliateSessionSyncResponse = envelope({
  type: 'object',
  properties: {
    provider: { type: 'string', enum: [...AFFILIATE_PROVIDERS] },
    status: { type: 'string', enum: [...AFFILIATE_CREDENTIAL_STATUSES] },
    updatedAt: { type: 'string', format: 'date-time' },
  },
});
