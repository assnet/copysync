import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { CapturedOffer, CapturedOfferReason } from '../entities/CapturedOffer';

export interface NewCapturedOffer {
  tenantId: string;
  sessionId: string;
  configId: string;
  monitoredGroupId: string;
  sourceExternalMessageId: string;
  sourceText: string;
  sourceMediaUrl: string | null;
  imageUnavailable: boolean;
  capturedAt: Date;
}

export interface CapturedOfferResolution {
  marketplace: AffiliateProvider | null;
  sourceUrl: string | null;
  affiliateUrl: string | null;
  coupon: string | null;
  finalText: string | null;
  expiresAt: Date | null;
  startsAt: Date | null;
}

export interface CapturedOfferListItem extends CapturedOffer {
  sourceGroupTitle: string | null;
  sourceGroupAvatarUrl: string | null;
}

export interface ICapturedOfferRepository {
  /** false = mensagem já capturada (mesma sessão + id externo). */
  createPending(input: NewCapturedOffer): Promise<boolean>;
  /**
   * Worker, cross-tenant: PENDING (ou PROCESSING com claim anterior a `staleBefore`) → PROCESSING
   * com `claimToken` novo, SKIP LOCKED, mais antigas primeiro.
   */
  claimPending(limit: number, staleBefore: Date): Promise<CapturedOffer[]>;
  /** Só com o token da posse; false = posse perdida. */
  markQueued(id: string, claimToken: string, data: CapturedOfferResolution & { offerId: string }): Promise<boolean>;
  markSkipped(id: string, claimToken: string, reason: CapturedOfferReason, data?: Partial<CapturedOfferResolution>): Promise<boolean>;
  markFailed(id: string, claimToken: string, reason: CapturedOfferReason, data?: Partial<CapturedOfferResolution>): Promise<boolean>;
  list(tenantId: string, sessionId: string, offset: number, limit: number): Promise<CapturedOfferListItem[]>;
  findById(tenantId: string, id: string): Promise<CapturedOfferListItem | null>;
  /** SKIPPED/FAILED → PENDING, sem motivo. false se o estado mudou. */
  resetForRetry(tenantId: string, id: string): Promise<boolean>;
}
