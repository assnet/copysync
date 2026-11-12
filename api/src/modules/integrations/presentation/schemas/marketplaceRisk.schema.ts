import { AFFILIATE_PROVIDERS } from '../../domain/enums/AffiliateProvider';
import { MARKETPLACE_RISK_SCOPES } from '../../domain/enums/MarketplaceRiskScope';

export const acceptMarketplaceRiskBodySchema = {
  type: 'object',
  required: ['noticeVersion', 'locale'],
  properties: {
    noticeVersion: { type: 'string', minLength: 1, maxLength: 32 },
    locale: { type: 'string', pattern: '^[a-z]{2}(-[A-Z]{2})?$' },
    /** Padrão `AFFILIATE_LINK`. */
    scope: { type: 'string', enum: [...MARKETPLACE_RISK_SCOPES] },
  },
  additionalProperties: false,
} as const;

const acceptanceResult = {
  type: 'object',
  properties: {
    acceptedAt: { type: 'string', format: 'date-time' },
    noticeVersion: { type: 'string' },
    scope: { type: 'string', enum: [...MARKETPLACE_RISK_SCOPES] },
  },
} as const;

export const acceptMarketplaceRiskResponse = {
  type: 'object',
  properties: { success: { type: 'boolean' }, data: acceptanceResult },
} as const;

export const tenantIdParamSchema = {
  type: 'object',
  required: ['tenantId'],
  properties: { tenantId: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

export const marketplaceRiskAcceptanceListResponse = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: [...AFFILIATE_PROVIDERS] },
          scope: { type: 'string', enum: [...MARKETPLACE_RISK_SCOPES] },
          noticeVersion: { type: 'string' },
          acceptedByUserId: { type: 'string' },
          locale: { type: 'string' },
          acceptedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
} as const;
