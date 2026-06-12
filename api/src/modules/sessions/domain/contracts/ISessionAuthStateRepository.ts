export interface SessionAuthStateRecord {
  sessionId: string;
  tenantId: string;
  provider: string;
  statePayload: unknown;
  version: number;
}

export interface SessionAuthStateUpsertData {
  sessionId: string;
  tenantId: string;
  provider: string;
  statePayload: unknown;
}

export interface ISessionAuthStateRepository {
  findBySessionId(sessionId: string): Promise<SessionAuthStateRecord | null>;
  /** Inserts or updates the auth state, incrementing version on update. */
  upsert(data: SessionAuthStateUpsertData): Promise<void>;
  /**
   * Wipes credentials after WhatsApp logout while keeping the row keyed by sessionId.
   * Preserves the session↔auth_state link so reconnect on the same session reuses history.
   */
  clearCredentials(sessionId: string): Promise<void>;
  /** Silently removes auth state; no-op when record does not exist. */
  deleteBySessionId(sessionId: string): Promise<void>;
}
