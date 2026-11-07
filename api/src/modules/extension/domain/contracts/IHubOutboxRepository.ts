export interface OutboxHeadEvent {
  id: string;
  clientKey: string;
  seq: number;
  installationId: string | null;
  type: string;
  payload: unknown;
  attempts: number;
  nextAttemptAt: Date | null;
}

export interface IHubOutboxRepository {
  claimHeads(lockedUntil: Date): Promise<OutboxHeadEvent[]>;
  markSent(id: string): Promise<void>;
  markDead(id: string): Promise<void>;
  scheduleRetry(id: string, nextAttemptAt: Date): Promise<void>;
  releaseLock(id: string): Promise<void>;
  purgeSent(before: Date): Promise<number>;
  purgeDead(before: Date): Promise<number>;
}
