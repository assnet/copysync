import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { CapturedOfferStatus } from '../../domain/entities/CapturedOffer';
import type { OfferStatus } from '../../../campaigns/domain/enums/OfferStatus';
import type { GroupMonitorSettings, MonitorTextMode } from '../../domain/entities/GroupMonitor';
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
  /** De onde saiu o texto enviado (ORIGINAL | TEMPLATE | AI); null até processar. */
  textSource: MonitorTextMode | null;
  /** `AI_*` quando a IA foi pedida e o texto caiu no modelo. */
  aiErrorCode: string | null;
  /** Estado da oferta na fila; pausar/retomar/parar agem nela (todos os grupos de disparo). */
  offerStatus: OfferStatus | null;
  /** Envios concluídos × total da oferta. */
  sentCount: number;
  totalCount: number;
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
    textSource: c.textSource,
    aiErrorCode: c.aiErrorCode,
    offerStatus: c.offerStatus,
    sentCount: c.sentCount,
    totalCount: c.totalCount,
    capturedAt: c.capturedAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString() ?? null,
    startsAt: c.startsAt?.toISOString() ?? null,
    imageUnavailable: c.imageUnavailable,
  };
}
