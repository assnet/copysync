import { AFFILIATE_PROVIDERS } from '../../../integrations/domain/enums/AffiliateProvider';
import { OFFER_STATUSES } from '../../../campaigns/domain/enums/OfferStatus';
import { CAPTURED_OFFER_STATUSES } from '../../domain/entities/CapturedOffer';
import { MONITOR_TEXT_MODES } from '../../domain/entities/GroupMonitor';
import { OFFER_AUDIENCES } from '../../../campaigns/domain/enums/OfferAudience';
import { MONITOR_LIMITS } from '../../domain/services/monitorSettings';
import { MINUTES_PER_DAY } from '../../domain/services/operatingWindow';

const sessionId = { type: 'string', minLength: 1, maxLength: 64 } as const;
const groupJid = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[^@\\s]+$' } as const;
const int = (min: number, max: number) => ({ type: 'integer', minimum: min, maximum: max }) as const;

// Faixas finas (min ≤ max, cupom ≤ oferta, janela vazia) são 422 no use case.
const settingsProperties = {
  enabled: { type: 'boolean' },
  windowStartMinute: int(0, MINUTES_PER_DAY),
  windowEndMinute: int(0, MINUTES_PER_DAY),
  captureOutsideWindow: { type: 'boolean' },
  intervalMinSeconds: int(MONITOR_LIMITS.intervalSeconds.min, MONITOR_LIMITS.intervalSeconds.max),
  intervalMaxSeconds: int(MONITOR_LIMITS.intervalSeconds.min, MONITOR_LIMITS.intervalSeconds.max),
  startDelaySeconds: int(MONITOR_LIMITS.startDelaySeconds.min, MONITOR_LIMITS.startDelaySeconds.max),
  maxOfferAgeMinutes: int(MONITOR_LIMITS.offerAgeMinutes.min, MONITOR_LIMITS.offerAgeMinutes.max),
  couponMaxAgeMinutes: int(MONITOR_LIMITS.offerAgeMinutes.min, MONITOR_LIMITS.offerAgeMinutes.max),
  mentionAll: { type: 'boolean' },
  simulateTyping: { type: 'boolean' },
  typingSeconds: int(MONITOR_LIMITS.typingSeconds.min, MONITOR_LIMITS.typingSeconds.max),
  textMode: { type: 'string', enum: [...MONITOR_TEXT_MODES] },
  audience: { type: 'string', enum: [...OFFER_AUDIENCES] },
  enrichLinkOnly: { type: 'boolean' },
} as const;
const settingsKeys = Object.keys(settingsProperties);

export const sessionQuerySchema = {
  type: 'object', required: ['sessionId'], additionalProperties: false, properties: { sessionId },
} as const;

export const capturedQuerySchema = {
  type: 'object', required: ['sessionId'], additionalProperties: false,
  properties: { sessionId, cursor: { type: 'string', maxLength: 512 } },
} as const;

export const capturedIdParamSchema = {
  type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

export const saveSettingsBodySchema = {
  type: 'object', additionalProperties: false, required: ['sessionId', ...settingsKeys],
  properties: { sessionId, ...settingsProperties },
} as const;

export const saveMonitoredBodySchema = {
  type: 'object', additionalProperties: false, required: ['sessionId', 'groups'],
  properties: {
    sessionId,
    groups: {
      type: 'array', maxItems: MONITOR_LIMITS.groupsPerSession,
      items: {
        type: 'object', additionalProperties: false, required: ['groupJid', 'keywords'],
        properties: {
          groupJid,
          keywords: { type: 'array', maxItems: MONITOR_LIMITS.keywordsPerGroup, items: { type: 'string', maxLength: MONITOR_LIMITS.keywordLength } },
        },
      },
    },
  },
} as const;

export const saveBroadcastBodySchema = {
  type: 'object', additionalProperties: false, required: ['sessionId', 'groups'],
  properties: {
    sessionId,
    groups: {
      type: 'array', maxItems: MONITOR_LIMITS.groupsPerSession,
      items: {
        type: 'object', additionalProperties: false, required: ['groupJid'],
        // sessionId ausente/null = a sessão do monitor; outra sessão exige `cross_session_dispatch`
        properties: { groupJid, sessionId: { type: ['string', 'null'], minLength: 1, maxLength: 64 } },
      },
    },
  },
} as const;

// ── Saída (envelope { success, data }), lista fechada de campos ──────────────
const nullableString = { type: ['string', 'null'] } as const;
const nullableDate = { type: ['string', 'null'], format: 'date-time' } as const;
const nullableInt = { type: ['integer', 'null'] } as const;
const envelope = (data: object) => ({ type: 'object', properties: { success: { type: 'boolean' }, data } });

const groupBase = { conversationId: { type: 'string' }, groupJid: { type: 'string' }, title: nullableString, avatarUrl: nullableString } as const;

const configSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string' },
    settings: { type: 'object', properties: settingsProperties },
    monitoredGroups: { type: 'array', items: { type: 'object', properties: { ...groupBase, keywords: { type: 'array', items: { type: 'string' } } } } },
    broadcastGroups: { type: 'array', items: { type: 'object', properties: { ...groupBase, sessionId: { type: 'string' }, position: { type: 'integer' } } } },
    limits: { type: 'object', properties: { monitoredGroups: nullableInt, broadcastGroups: nullableInt, mentionAllEnabled: { type: 'boolean' }, crossSessionDispatch: { type: 'boolean' } } },
    credentialAlerts: {
      type: 'array',
      items: { type: 'object', properties: { provider: { type: 'string', enum: [...AFFILIATE_PROVIDERS] }, kind: { type: 'string', enum: ['MISSING', 'REJECTED'] }, since: nullableDate, code: nullableString } },
    },
    usage: { type: 'object', properties: { monitoredGroups: { type: 'integer' }, broadcastGroups: { type: 'integer' } } },
  },
} as const;

const capturedSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: [...CAPTURED_OFFER_STATUSES] },
    reason: nullableString,
    marketplace: { type: ['string', 'null'], enum: [...AFFILIATE_PROVIDERS, null] },
    sourceGroupTitle: nullableString,
    sourceGroupAvatarUrl: nullableString,
    textPreview: { type: 'string' },
    imageUrl: nullableString,
    coupon: nullableString,
    affiliateUrl: nullableString,
    offerId: nullableString,
    textSource: { type: ['string', 'null'], enum: [...MONITOR_TEXT_MODES, null] },
    aiErrorCode: nullableString,
    offerStatus: { type: ['string', 'null'], enum: [...OFFER_STATUSES, null] },
    sentCount: { type: 'integer' },
    totalCount: { type: 'integer' },
    capturedAt: { type: 'string', format: 'date-time' },
    expiresAt: nullableDate,
    startsAt: nullableDate,
    imageUnavailable: { type: 'boolean' },
  },
} as const;

export const configResponse = envelope(configSchema);
export const capturedResponse = envelope(capturedSchema);
export const capturedListResponse = envelope({
  type: 'object', properties: { items: { type: 'array', items: capturedSchema }, nextCursor: nullableString },
});
