/**
 * Chaves de entitlement do tenant (vindas do hub por plano; `docs/arquitetura-central-billing.md`).
 * Única fonte: módulos importam daqui, nunca literal solto. Numérico `null`/ausente = ilimitado;
 * booleano de FEATURE ausente = desligado (`cross_session_dispatch`), exceto os que o produto já
 * tratava como "só `false` explícito bloqueia" (`mention_all_enabled`, `ai_rewrite_enabled`).
 */
export const ENTITLEMENT_KEYS = {
  WHATSAPP_SESSIONS: 'whatsapp_sessions',
  MONITORED_GROUPS: 'monitored_groups',
  BROADCAST_GROUPS: 'broadcast_groups',
  MENTION_ALL_ENABLED: 'mention_all_enabled',
  OFFER_GENERATIONS_PER_DAY: 'offer_generations_per_day',
  MARKETPLACE_EXTENSION: 'marketplace_extension',
  AI_REWRITE_ENABLED: 'ai_rewrite_enabled',
  AI_REQUESTS_PER_DAY: 'ai_requests_per_day',
  /** Grupo de disparo em sessão diferente de onde a oferta nasce (Business). Ausente = bloqueado. */
  CROSS_SESSION_DISPATCH: 'cross_session_dispatch',
} as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[keyof typeof ENTITLEMENT_KEYS];
