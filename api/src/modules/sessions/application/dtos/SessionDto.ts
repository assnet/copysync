import type { SessionStatus } from '../../domain/enums/SessionStatus';

// ── Input DTOs ────────────────────────────────────────────────────────────────

export interface CreateSessionInputDto {
  name: string;
  engine?: string;
}

// ── Output DTOs ───────────────────────────────────────────────────────────────

export interface SessionItemDto {
  id: string;
  tenantId: string;
  name: string;
  engine: string;
  phone: string | null;
  externalRef: string | null;
  status: SessionStatus;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionStatusDto {
  sessionId: string;
  status: SessionStatus;
  phone: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
}

/**
 * Generic output for connect / reconnect actions.
 * qrCode and pairingCode will be populated once the engine is integrated.
 */
export interface SessionActionDto {
  sessionId: string;
  status: SessionStatus;
  qrCode?: string;
  pairingCode?: string;
}
