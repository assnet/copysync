export interface ISaverSessionStateStore {
  /** Sessões com lease vivo DESTE processo (`ownerWorkerId` + `leaseUntil`), sem `deletedAt`. */
  ownedSessionIds(): Promise<string[]>;
  /** Sessões sem `pausedUntil` futuro e com `nextScanAt <= now`, entre as informadas. */
  dueSessions(sessionIds: readonly string[], now: Date): Promise<string[]>;
  scheduleNext(sessionId: string, tenantId: string, nextScanAt: Date): Promise<void>;
  pause(sessionId: string, tenantId: string, until: Date, reason: string): Promise<void>;
}
