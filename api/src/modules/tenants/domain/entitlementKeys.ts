/**
 * Chaves de entitlement do tenant (vindas do hub por plano; `docs/arquitetura-central-billing.md`).
 * Única fonte: módulos importam daqui, nunca literal solto. Numérico `null`/ausente = ilimitado;
 * booleano de FEATURE ausente = desligado (`cross_session_dispatch`), exceto os que o produto já
 * tratava como "só `false` explícito bloqueia" (`mention_all_enabled`, `ai_rewrite_enabled`).
 */
export const ENTITLEMENT_KEYS = {
  WHATSAPP_SESSIONS: 'whatsapp_sessions',
  /** Sessões Telegram (conta de usuário, MTProto). 0 no Lite, 1 no Pro, 2 no Max. */
  TELEGRAM_SESSIONS: 'telegram_sessions',
  /** Grupos monitorados no WhatsApp (canal = engine da sessão; `tenants/domain/channelLimits.ts`). */
  MONITORED_GROUPS: 'monitored_groups',
  /** Grupos de disparo no WhatsApp. */
  BROADCAST_GROUPS: 'broadcast_groups',
  /** Grupos monitorados no Telegram. 0 no Lite, 2 no Pro, 6 no Max. */
  TELEGRAM_MONITORED_GROUPS: 'telegram_monitored_groups',
  /** Grupos de disparo no Telegram. 0 no Lite, 10 no Pro, 40 no Max. */
  TELEGRAM_BROADCAST_GROUPS: 'telegram_broadcast_groups',
  MENTION_ALL_ENABLED: 'mention_all_enabled',
  OFFER_GENERATIONS_PER_DAY: 'offer_generations_per_day',
  MARKETPLACE_EXTENSION: 'marketplace_extension',
  /** Reescrita com IA (gerador e monitoramento): PRO e MAX; `false` explícito no LITE, ausente = liberado. */
  AI_REWRITE_ENABLED: 'ai_rewrite_enabled',
  AI_REQUESTS_PER_DAY: 'ai_requests_per_day',
  /** Grupo de disparo em sessão diferente de onde a oferta nasce (Business). Ausente = bloqueado. */
  CROSS_SESSION_DISPATCH: 'cross_session_dispatch',
  /** Rodízios de link no WhatsApp (canal = engine da sessão do rodízio; `channelLimits.ts`). */
  LINK_ROTATIONS: 'link_rotations',
  /** Grupos por rodízio no WhatsApp. */
  LINK_ROTATION_GROUPS: 'link_rotation_groups',
  /** Rodízios de link no Telegram. 0 no Lite, 1 no Pro, 2 no Max. */
  TELEGRAM_LINK_ROTATIONS: 'telegram_link_rotations',
  /** Grupos por rodízio no Telegram. 0 no Lite, 5 no Pro, 10 no Max. */
  TELEGRAM_LINK_ROTATION_GROUPS: 'telegram_link_rotation_groups',
  /** Página de Ofertas (Profissional e Business). `false` explícito no Starter. */
  STOREFRONT_ENABLED: 'storefront_enabled',
  /** Story de Oferta (arte para Instagram, só Business). Ausente = bloqueado. */
  OFFER_STORY_ENABLED: 'offer_story_enabled',
  /** Monitoramento: captura só com link vira oferta montada (Pro e Max). Ausente = bloqueado. */
  ENRICH_LINK_ONLY_ENABLED: 'enrich_link_only_enabled',
  /** Monitoramento: capturar fora do horário de postagem e acumular a fila (só Max). Ausente = bloqueado. */
  CAPTURE_OUTSIDE_WINDOW_ENABLED: 'capture_outside_window_enabled',
  /**
   * Shein como marketplace (sessão pela extensão, links, captura). Só `true` libera; ausente = bloqueado.
   * Preset: só MAX. O super admin libera outro plano pela rota admin (`adminEditableEntitlements.ts`).
   */
  MARKETPLACE_SHEIN_ENABLED: 'marketplace_shein_enabled',
  /**
   * Etiquetas da conta do Mercado Livre vinculadas ao tenant (principal incluída). LITE 1, PRO 2, MAX 10.
   * Exceção à regra acima: ausente/`null` vale 1, nunca ilimitado (`services/affiliateIdentifierLimit.ts`).
   */
  MERCADO_LIVRE_AFFILIATE_TAGS: 'mercado_livre_affiliate_tags',
  /**
   * Caçador de Ofertas (busca automática no catálogo da Shein). Só `true` libera; ausente = bloqueado.
   * Preset: só MAX; editável pelo super admin (`adminEditableEntitlements.ts`).
   */
  OFFER_HUNTER_ENABLED: 'offer_hunter_enabled',
  /**
   * Achados por dia do Caçador de Ofertas. LITE 0, PRO 0, MAX 10; editável pelo super admin (inteiro 0–100).
   * Exceção à regra acima: ausente/`null` vale 0, nunca ilimitado (no caçador, sempre `?? 0`).
   */
  OFFER_HUNTER_FINDS_PER_DAY: 'offer_hunter_finds_per_day',
} as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[keyof typeof ENTITLEMENT_KEYS];
