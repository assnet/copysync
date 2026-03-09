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

  set(sessionId: string, entry: ActiveSessionEntry): void {
    this.sessions.set(sessionId, entry);
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
