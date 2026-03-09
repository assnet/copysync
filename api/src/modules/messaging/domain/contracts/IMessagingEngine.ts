import type { SessionStatus } from '../../../sessions/domain/enums/SessionStatus';

// ── Input types ───────────────────────────────────────────────────────────────

export interface CreateSessionInput {
  sessionId: string;
  tenantId: string;
}

export interface SendTextMessageInput {
  sessionId: string;
  tenantId: string;
  to: string;
  body: string;
}

export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker';

export interface SendMediaMessageInput {
  sessionId: string;
  tenantId: string;
  to: string;
  mediaUrl: string;
  mediaType: MediaType;
  caption?: string;
}

// ── Output types ──────────────────────────────────────────────────────────────

export interface ConnectSessionResult {
  /** Present when engine requests QR-code-based auth */
  qrCode?: string;
  /** Present when engine requests pairing-code-based auth */
  pairingCode?: string;
}

export interface SendMessageResult {
  messageId: string;
  sentAt: Date;
}

export { SessionStatus as MessagingSessionStatus };

// ── Engine port ───────────────────────────────────────────────────────────────

/**
 * Primary port for the messaging engine.
 *
 * The rest of the application depends ONLY on this interface.
 * Implementations (BaileysMessagingEngineAdapter, etc.) live in:
 *   infrastructure/engines/<engine-name>/
 *
 * This contract must never leak engine-specific types.
 */
export interface IMessagingEngine {
  createSession(input: CreateSessionInput): Promise<void>;
  connectSession(sessionId: string): Promise<ConnectSessionResult>;
  disconnectSession(sessionId: string): Promise<void>;
  reconnectSession(sessionId: string): Promise<void>;
  logoutSession(sessionId: string): Promise<void>;
  getSessionStatus(sessionId: string): Promise<SessionStatus>;
  sendTextMessage(input: SendTextMessageInput): Promise<SendMessageResult>;
  sendMediaMessage(input: SendMediaMessageInput): Promise<SendMessageResult>;
}
