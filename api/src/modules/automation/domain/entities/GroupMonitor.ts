import type { OfferAudience } from '../../../campaigns/domain/enums/OfferAudience';

/** Texto enviado: ORIGINAL = do grupo com links trocados; TEMPLATE = modelo fixo com dados do produto; AI = reescrito. */
export const MONITOR_TEXT_MODES = ['ORIGINAL', 'TEMPLATE', 'AI'] as const;
export type MonitorTextMode = (typeof MONITOR_TEXT_MODES)[number];

/** Regras de envio e captura do monitoramento de UMA sessão. Minutos do dia em America/Sao_Paulo. */
export interface GroupMonitorSettings {
  enabled: boolean;
  windowStartMinute: number;
  windowEndMinute: number;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  startDelaySeconds: number;
  maxOfferAgeMinutes: number;
  couponMaxAgeMinutes: number;
  mentionAll: boolean;
  simulateTyping: boolean;
  typingSeconds: number;
  textMode: MonitorTextMode;
  /** Só com `textMode: 'AI'`; `STANDARD` equivale ao modelo fixo. */
  audience: OfferAudience;
  /** Captura sem texto além de links vira oferta montada, mesmo em `ORIGINAL`. */
  enrichLinkOnly: boolean;
}

export interface GroupMonitorConfig extends GroupMonitorSettings {
  id: string;
  tenantId: string;
  sessionId: string;
}

/** Grupo de origem (concorrente). */
export interface MonitoredGroup {
  id: string;
  conversationId: string;
  groupJid: string;
  keywords: string[];
  title: string | null;
  avatarUrl: string | null;
}

/** Grupo de disparo (destino), na ordem de envio. `sessionId` = sessão que envia (pode ser outra, Business). */
export interface BroadcastGroup {
  id: string;
  sessionId: string;
  conversationId: string;
  groupJid: string;
  position: number;
  title: string | null;
  avatarUrl: string | null;
}
