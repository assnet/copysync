import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { MonitorTextMode } from './GroupMonitor';

export const CAPTURED_OFFER_STATUSES = ['PENDING', 'PROCESSING', 'QUEUED', 'SKIPPED', 'FAILED'] as const;
export type CapturedOfferStatus = (typeof CAPTURED_OFFER_STATUSES)[number];

/** Por que a captura não foi para a fila. SKIPPED = regra; FAILED = erro. */
export const CAPTURED_OFFER_REASONS = [
  'NO_LINK',
  'UNSUPPORTED_MARKETPLACE',
  'CREDENTIAL_MISSING',
  'CREDENTIAL_REJECTED',
  'LINK_RESOLVE_FAILED',
  'EXPIRED',
  'MONITOR_DISABLED',
  'NO_BROADCAST_GROUPS',
  'KEYWORD_MISMATCH',
  'INTERNAL_ERROR',
] as const;
export type CapturedOfferReason = (typeof CAPTURED_OFFER_REASONS)[number];

/** Motivos em que tentar de novo pode dar outro resultado (credencial salva, API voltou…). */
export const RETRYABLE_REASONS: ReadonlySet<CapturedOfferReason> = new Set([
  'CREDENTIAL_MISSING',
  'CREDENTIAL_REJECTED',
  'LINK_RESOLVE_FAILED',
  'NO_BROADCAST_GROUPS',
  'MONITOR_DISABLED',
  'INTERNAL_ERROR',
]);

export interface CapturedOffer {
  id: string;
  tenantId: string;
  sessionId: string;
  configId: string;
  monitoredGroupId: string | null;
  sourceExternalMessageId: string;
  sourceText: string;
  sourceMediaUrl: string | null;
  imageUnavailable: boolean;
  marketplace: AffiliateProvider | null;
  sourceUrl: string | null;
  affiliateUrl: string | null;
  coupon: string | null;
  finalText: string | null;
  status: CapturedOfferStatus;
  reason: string | null;
  offerId: string | null;
  /** De onde saiu `finalText`; null até processar. */
  textSource: MonitorTextMode | null;
  /** Código `AI_*` quando a IA foi pedida e o texto caiu no modelo fixo. */
  aiErrorCode: string | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  capturedAt: Date;
  processedAt: Date | null;
  claimToken: string | null;
}
