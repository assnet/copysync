import type { SessionStatus } from '../../../sessions/domain/enums/SessionStatus';

// ── Input types ───────────────────────────────────────────────────────────────

export interface CreateSessionInput {
  sessionId: string;
  tenantId: string;
}

export interface ConnectSessionInput {
  sessionId: string;
  tenantId: string;
}

export interface DisconnectSessionInput {
  sessionId: string;
  tenantId: string;
}

export interface ReconnectSessionInput {
  sessionId: string;
  tenantId: string;
}

export interface LogoutSessionInput {
  sessionId: string;
  tenantId: string;
}

export interface QuotedMessageRef {
  /** WhatsApp stanzaId da mensagem citada (key.id no Baileys) */
  externalId: string;
  /** Telefone/JID do contato da conversa */
  remoteJid: string;
  /** true se a mensagem citada foi enviada por nós */
  fromMe: boolean;
  /** Corpo de texto para o preview de contexto */
  body: string | null;
  /** Tipo da mensagem citada — usado para montar o proto.IMessage correto */
  type: string;
}

export interface SendTextMessageInput {
  sessionId: string;
  tenantId: string;
  to: string;
  body: string;
  quotedMessage?: QuotedMessageRef | null;
}

// ─────────────────────────────────────────────────────────────────────────────

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
  /** QR code is not returned synchronously — it arrives via SESSION_QR_UPDATED event. */
  qrCode?: string;
  /** Present only on pairing-code flows. */
  pairingCode?: string;
}

export interface SendMessageResult {
  messageId: string;
  sentAt: Date;
}

export interface MarkMessagesReadInput {
  sessionId: string;
  tenantId: string;
  /** Phone number of the contact (without @s.whatsapp.net) */
  remoteJid: string;
  /** Baileys message IDs (key.id) to mark as read */
  messageIds: string[];
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
  /** Prepare session metadata. Must be called before connectSession. */
  createSession(input: CreateSessionInput): Promise<void>;
  /** Initiate the WhatsApp connection. QR/pairing events arrive asynchronously. */
  connectSession(input: ConnectSessionInput): Promise<ConnectSessionResult>;
  /** Gracefully close the connection (state kept — can reconnect). */
  disconnectSession(input: DisconnectSessionInput): Promise<void>;
  /** Re-open a previously disconnected session. */
  reconnectSession(input: ReconnectSessionInput): Promise<void>;
  /** Logout from WhatsApp and clear credentials. */
  logoutSession(input: LogoutSessionInput): Promise<void>;
  /** Return current engine-level status for a session. */
  getSessionStatus(sessionId: string): Promise<SessionStatus>;
  /** Return the latest QR code for a session waiting for scan, or null. */
  getSessionQr(sessionId: string): Promise<string | null>;
  /** Return the latest pairing code for a session, or null. */
  getSessionPairingCode(sessionId: string): Promise<string | null>;
  sendTextMessage(input: SendTextMessageInput): Promise<SendMessageResult>;
  sendMediaMessage(input: SendMediaMessageInput): Promise<SendMessageResult>;
  /** Send read receipts so the contact sees the double-blue tick. */
  markMessagesRead(input: MarkMessagesReadInput): Promise<void>;
  /** Subscribe to presence updates for a specific JID. */
  presenceSubscribe(sessionId: string, phone: string): Promise<void>;
  /**
   * Lista os participantes de um grupo.
   *
   * `phone` fica nulo quando o participante usa privacidade de número e só o
   * identificador interno está disponível.
   */
  getGroupParticipants(sessionId: string, groupJid: string): Promise<GroupParticipantInfo[]>;
}

export interface GroupParticipantInfo {
  /** Telefone em dígitos, ou null quando não revelado pelo participante. */
  phone: string | null;
  /** Nome exibido, quando o WhatsApp o fornece. */
  name: string | null;
  isAdmin: boolean;
}

