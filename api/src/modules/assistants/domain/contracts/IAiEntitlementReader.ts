export interface IAiEntitlementReader {
  /** Entitlement `ai_rewrite_enabled` do tenant. Ausente = true; só `false` explícito desliga. */
  isAiRewriteEnabled(tenantId: string): Promise<boolean>;
  /** Entitlement `ai_requests_per_day` (teto diário na IA da plataforma). null se ausente ou não numérico. */
  aiRequestsPerDay(tenantId: string): Promise<number | null>;
}
