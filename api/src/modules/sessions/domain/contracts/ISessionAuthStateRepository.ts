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
  /** Silently removes auth state; no-op when record does not exist. */
  deleteBySessionId(sessionId: string): Promise<void>;
}
