export interface ISaverSessionStateStore {
  /** Sessões sem `pausedUntil` futuro e com `nextScanAt <= now`, entre as informadas. */
  dueSessions(sessionIds: readonly string[], now: Date): Promise<string[]>;
  scheduleNext(sessionId: string, tenantId: string, nextScanAt: Date): Promise<void>;
  pause(sessionId: string, tenantId: string, until: Date, reason: string): Promise<void>;
}
