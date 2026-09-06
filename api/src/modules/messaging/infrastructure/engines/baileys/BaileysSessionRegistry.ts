/**
 * BaileysSessionRegistry
 *
 * In-memory registry of active Baileys socket connections.
 * Acts as a cache only — the authoritative state lives in the DB.
 *
 * Responsibilities:
 *  - Keep WASocket instances alive between requests
 *  - Store ephemeral per-session data (latest QR, pairingCode)
 *  - Never used as the source of truth for session status
 */
import type { WASocket } from '@whiskeysockets/baileys';

export interface ActiveSessionEntry {
  socket: WASocket;
  tenantId: string;
  /**
   * Monotonic id of the socket generation. Every openSocket() call produces a new
   * epoch; event handlers carry the epoch they were registered with so that events
   * emitted by a socket that was already replaced can be discarded.
   */
  epoch: number;
  /** Consecutive automatic reconnect attempts. Reset to 0 once the connection opens. */
  reconnectAttempt: number;
  /** Latest QR string, set via SESSION_QR_UPDATED event. Cleared on connect. */
  latestQr?: string;
  /** Latest pairing code, set via SESSION_PAIRING_CODE_UPDATED. */
  latestPairingCode?: string;
}

export class BaileysSessionRegistry {
  private static readonly instance = new BaileysSessionRegistry();

  static get(): BaileysSessionRegistry {
    return BaileysSessionRegistry.instance;
  }

  private readonly sessions = new Map<string, ActiveSessionEntry>();

  private epochCounter = 0;

  /** Reserve the next socket generation id. */
  nextEpoch(): number {
    this.epochCounter += 1;
    return this.epochCounter;
  }

  set(sessionId: string, entry: ActiveSessionEntry): void {
    this.sessions.set(sessionId, entry);
  }

  /** True when the given epoch still owns the session (i.e. it is the live socket). */
  isCurrentEpoch(sessionId: string, epoch: number): boolean {
    return this.sessions.get(sessionId)?.epoch === epoch;
  }

  /** Removes the entry only when it still belongs to the given epoch. */
  deleteIfCurrentEpoch(sessionId: string, epoch: number): boolean {
    if (!this.isCurrentEpoch(sessionId, epoch)) return false;
    this.sessions.delete(sessionId);
    return true;
  }

  getReconnectAttempt(sessionId: string): number {
    return this.sessions.get(sessionId)?.reconnectAttempt ?? 0;
  }

  setReconnectAttempt(sessionId: string, attempt: number): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.reconnectAttempt = attempt;
  }

  get(sessionId: string): ActiveSessionEntry | undefined {
    return this.sessions.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  setQr(sessionId: string, qr: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.latestQr = qr;
  }

  clearQr(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.latestQr = undefined;
    }
  }

  setPairingCode(sessionId: string, code: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.latestPairingCode = code;
  }

  getQr(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.latestQr;
  }

  getPairingCode(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.latestPairingCode;
  }

  getAll(): Array<{ sessionId: string; tenantId: string }> {
    return Array.from(this.sessions.entries()).map(([sessionId, entry]) => ({
      sessionId,
      tenantId: entry.tenantId,
    }));
  }
}
