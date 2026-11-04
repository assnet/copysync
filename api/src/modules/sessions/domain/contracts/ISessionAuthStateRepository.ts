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
  /**
   * CAS (LEASE-06): número = só grava se `session_auth_states.version` ainda for esse valor;
   * `null` = só grava se a linha ainda não existir; ausente = sem checagem (Telegram, migração legada).
   */
  expectedVersion?: number | null;
}

/** Chaves + versão lidas no mesmo snapshot; `version` null = linha-mãe ainda não existe. */
export interface VersionedAuthKeys {
  keys: Record<string, unknown>;
  version: number | null;
}

/**
 * `ok: true` traz a versão após a escrita (`null` só em lote vazio sem `expectedVersion` numérico:
 * nada foi lido nem gravado). `VERSION_CONFLICT` = outro dono gravou/limpou; nenhuma chave foi tocada.
 */
export type WriteKeysResult =
  | { ok: true; version: number | null }
  | { ok: false; reason: 'VERSION_CONFLICT' };

export interface ISessionAuthStateRepository {
  findBySessionId(sessionId: string): Promise<SessionAuthStateRecord | null>;
  /**
   * LEGADO (blob único): insere ou atualiza o estado inteiro. Só a migração e o rollback usam.
   */
  upsert(data: SessionAuthStateUpsertData): Promise<void>;
  /** Todas as chaves da sessão (uma consulta, no boot da sessão). */
  findAllKeys(sessionId: string): Promise<Record<string, unknown>>;
  /** Todas as chaves + `version` da linha-mãe, numa transação de leitura (base do CAS). */
  findAllKeysVersioned(sessionId: string): Promise<VersionedAuthKeys>;
  /**
   * Grava só as chaves alteradas e apaga as removidas, numa transação. Garante a linha de
   * `session_auth_states` (tenant/provider) e incrementa `version`. Lote vazio = no-op.
   * Com `expectedVersion`, a versão é conferida e incrementada ANTES das chaves; divergiu =
   * `VERSION_CONFLICT` sem gravar nada.
   */
  writeKeys(batch: SessionAuthKeyBatch): Promise<WriteKeysResult>;
  /**
   * Wipes credentials after WhatsApp logout while keeping the row keyed by sessionId.
   * Preserves the session↔auth_state link so reconnect on the same session reuses history.
   */
  clearCredentials(sessionId: string): Promise<void>;
  /** Silently removes auth state; no-op when record does not exist. */
  deleteBySessionId(sessionId: string): Promise<void>;
}
