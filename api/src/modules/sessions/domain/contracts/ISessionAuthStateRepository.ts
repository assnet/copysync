export interface SessionAuthStateRecord {
  sessionId: string;
  tenantId: string;
  provider: string;
  /** LEGADO: blob único (vazio/`{}` quando a sessão já foi migrada para chaves). */
  statePayload: unknown;
  version: number;
}

export interface SessionAuthStateUpsertData {
  sessionId: string;
  tenantId: string;
  provider: string;
  statePayload: unknown;
}

/** Alterações de um flush: só o que mudou desde o último (docs/sessoes-auth-state.md). */
export interface SessionAuthKeyBatch {
  sessionId: string;
  tenantId: string;
  provider: string;
  /** chave → valor serializado (BufferJSON). */
  upserts: Record<string, unknown>;
  deletes: string[];
}

export interface ISessionAuthStateRepository {
  findBySessionId(sessionId: string): Promise<SessionAuthStateRecord | null>;
  /**
   * LEGADO (blob único): insere ou atualiza o estado inteiro. Só a migração e o rollback usam.
   */
  upsert(data: SessionAuthStateUpsertData): Promise<void>;
  /** Todas as chaves da sessão (uma consulta, no boot da sessão). */
  findAllKeys(sessionId: string): Promise<Record<string, unknown>>;
  /**
   * Grava só as chaves alteradas e apaga as removidas, numa transação. Garante a linha de
   * `session_auth_states` (tenant/provider) e incrementa `version`. Lote vazio = no-op.
   */
  writeKeys(batch: SessionAuthKeyBatch): Promise<void>;
  /**
   * Wipes credentials after WhatsApp logout while keeping the row keyed by sessionId.
   * Preserves the session↔auth_state link so reconnect on the same session reuses history.
   */
  clearCredentials(sessionId: string): Promise<void>;
  /** Silently removes auth state; no-op when record does not exist. */
  deleteBySessionId(sessionId: string): Promise<void>;
}
