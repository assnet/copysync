export type AiAuditAction =
  | 'AI_SETTINGS_UPDATED'
  | 'AI_PROVIDER_CREATED'
  | 'AI_PROVIDER_UPDATED'
  | 'AI_PROVIDER_DELETED'
  | 'AI_CREDENTIAL_UPSERTED'
  | 'AI_CREDENTIAL_DELETED';

/** Trilha de auditoria das mudanças de IA. `meta` nunca leva chave. */
export interface IAiAuditTrail {
  record(input: { action: AiAuditAction; userId: string; tenantId?: string; meta?: Record<string, unknown> }): Promise<void>;
}
