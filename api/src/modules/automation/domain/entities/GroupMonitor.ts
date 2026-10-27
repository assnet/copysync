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

/** Grupo de disparo (destino), na ordem de envio. */
export interface BroadcastGroup {
  id: string;
  conversationId: string;
  groupJid: string;
  position: number;
  title: string | null;
  avatarUrl: string | null;
}
