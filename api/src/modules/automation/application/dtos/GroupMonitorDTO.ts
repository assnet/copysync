import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { CapturedOfferStatus } from '../../domain/entities/CapturedOffer';
import type { OfferStatus } from '../../../campaigns/domain/enums/OfferStatus';
import type { GroupMonitorSettings, MonitorTextMode } from '../../domain/entities/GroupMonitor';
import type { CapturedOfferListItem } from '../../domain/contracts/ICapturedOfferRepository';
import type { LimitChannel } from '../../../tenants/domain/channelLimits';
import type { GroupPostability } from '../../../campaigns/domain/services/groupPostability';
import { previewText } from '../../domain/services/offerMessageText';

export interface CredentialAlertDTO {
  provider: AffiliateProvider;
  kind: 'MISSING' | 'REJECTED';
  /** `rejectedAt` (REJECTED); null em MISSING. */
  since: string | null;
  code: string | null;
}

/** Limite (null = sem limite do plano) ou uso de grupos num canal. */
export interface ChannelGroupLimitsDTO { monitoredGroups: number | null; broadcastGroups: number | null }
export interface ChannelGroupUsageDTO { monitoredGroups: number; broadcastGroups: number }

/** Configuração devolvida: `weekdays` = dias de postagem (0 = domingo … 6 = sábado), ordenados; ausente = todos. */
export type GroupMonitorSettingsDTO = GroupMonitorSettings & { weekdays?: number[] };

export interface GroupMonitorConfigDTO {
  sessionId: string;
  /** Canal da sessão do monitor (`whatsapp` | `telegram`): os grupos monitorados contam nele. */
  channel: LimitChannel;
  settings: GroupMonitorSettingsDTO;
  monitoredGroups: { conversationId: string; groupJid: string; title: string | null; avatarUrl: string | null; keywords: string[] }[];
  /** `sessionId` = sessão que envia naquele grupo (igual à do monitor, ou outra com `crossSessionDispatch`). */
  broadcastGroups: ({ conversationId: string; groupJid: string; sessionId: string; title: string | null; avatarUrl: string | null; position: number } & GroupPostability)[];
  /**
   * Por canal (canal do grupo = engine da sessão dona). `monitoredGroups`/`broadcastGroups` na raiz =
   * WhatsApp (legado, até o painel migrar para `whatsapp`/`telegram`). `crossSessionDispatch` só é
   * exigido para 2+ sessões do mesmo canal.
   */
  limits: ChannelGroupLimitsDTO & {
    mentionAllEnabled: boolean;
    crossSessionDispatch: boolean;
    whatsapp: ChannelGroupLimitsDTO;
    telegram: ChannelGroupLimitsDTO;
  };
  /** Só no GET: loja sem credencial (com captura recente) ou recusada. Save* não devolve. */
  credentialAlerts?: CredentialAlertDTO[];
  /** Uso no tenant inteiro por canal; raiz = WhatsApp (legado). */
  usage: ChannelGroupUsageDTO & { whatsapp: ChannelGroupUsageDTO; telegram: ChannelGroupUsageDTO };
  /** Destinos (sessão + JID) de monitoramentos de outras sessões: não podem entrar nesta lista. */
  takenBroadcastGroups: { groupJid: string; sessionId: string; monitorSessionId: string }[];
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
