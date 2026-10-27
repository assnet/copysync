import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { CapturedOfferStatus } from '../../domain/entities/CapturedOffer';
import type { GroupMonitorSettings } from '../../domain/entities/GroupMonitor';
import type { CapturedOfferListItem } from '../../domain/contracts/ICapturedOfferRepository';
import { previewText } from '../../domain/services/offerMessageText';

export interface GroupMonitorConfigDTO {
  sessionId: string;
  settings: GroupMonitorSettings;
  monitoredGroups: { conversationId: string; groupJid: string; title: string | null; avatarUrl: string | null; keywords: string[] }[];
  broadcastGroups: { conversationId: string; groupJid: string; title: string | null; avatarUrl: string | null; position: number }[];
  limits: { monitoredGroups: number | null; broadcastGroups: number | null; mentionAllEnabled: boolean };
  usage: { monitoredGroups: number; broadcastGroups: number };
}

export interface CapturedOfferDTO {
  id: string;
  status: CapturedOfferStatus;
  reason: string | null;
  marketplace: AffiliateProvider | null;
  sourceGroupTitle: string | null;
  sourceGroupAvatarUrl: string | null;
  textPreview: string;
  imageUrl: string | null;
  coupon: string | null;
  affiliateUrl: string | null;
  offerId: string | null;
  capturedAt: string;
  expiresAt: string | null;
  startsAt: string | null;
  imageUnavailable: boolean;
}

export function toCapturedOfferDto(c: CapturedOfferListItem): CapturedOfferDTO {
  return {
    id: c.id,
    status: c.status,
    reason: c.reason,
    marketplace: c.marketplace,
    sourceGroupTitle: c.sourceGroupTitle,
    sourceGroupAvatarUrl: c.sourceGroupAvatarUrl,
    textPreview: previewText(c.finalText ?? c.sourceText),
    imageUrl: c.sourceMediaUrl,
    coupon: c.coupon,
    affiliateUrl: c.affiliateUrl,
    offerId: c.offerId,
    capturedAt: c.capturedAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString() ?? null,
    startsAt: c.startsAt?.toISOString() ?? null,
    imageUnavailable: c.imageUnavailable,
  };
}
