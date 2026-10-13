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
  /**
   * Autor da mensagem citada em grupo, quando não é nossa. Sem ele o WhatsApp atribui a
   * citação ao próprio grupo — por isso a engine não cita em grupo sem autor.
   */
  participant?: string | null;
  /** MIME da mídia citada — deixa o preview da citação igual ao do cliente oficial. */
  mimeType?: string | null;
  /** Nome do documento citado. */
  fileName?: string | null;
  /** Duração do áudio/vídeo citado, em segundos. */
  durationSeconds?: number | null;
}

export interface SendTextMessageInput {
  sessionId: string;
  tenantId: string;
  to: string;
  body: string;
  quotedMessage?: QuotedMessageRef | null;
  /** Telefones (dígitos) dos participantes marcados com @ no corpo — menção estruturada. */
  mentions?: string[] | null;
}

/**
 * Referência à mensagem que recebe a reação, montada a partir do que o chat já gravou.
 * Mesmo papel do `QuotedMessageRef`, sem os campos de preview.
 */
export interface ReactionTargetRef {
  /** key.id da mensagem alvo no WhatsApp */
  externalId: string;
  /** Telefone (individual) ou "<groupJid>@g.us" (grupo) */
  remoteJid: string;
  /** true quando a mensagem alvo foi enviada por nós */
  fromMe: boolean;
  /** JID do participante autor da mensagem alvo (obrigatório em grupo p/ montar a key) */
  participant?: string | null;
}

export interface SendReactionInput {
  sessionId: string;
  tenantId: string;
  target: ReactionTargetRef;
  /** Emoji a aplicar; `null` remove a reação existente. */
  emoji: string | null;
  /**
   * Carimbo do gesto, fixado pelo use case (relógio do servidor). A engine o envia como
   * `senderTimestampMs` — sem ele a lib usaria o próprio `Date.now()`.
   * O destinatário recebe o mesmo carimbo que gravamos; a nossa ordenação não depende disso.
   */
  reactedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Como a mídia chega ao contato: foto, vídeo, nota de voz ou arquivo. */
export type OutboundMediaKind = 'image' | 'video' | 'voice' | 'document';

/**
 * Arquivo pronto para envio, já classificado e processado. A engine lê do disco em stream —
 * nunca recebe o conteúdo em memória.
 */
export interface OutboundMedia {
  kind: OutboundMediaKind;
  /** Caminho absoluto, dentro da storage de mídia. */
  filePath: string;
  mimeType: string;
  /** Nome exibido ao contato (obrigatório para `document`). */
  fileName?: string | null;
  caption?: string | null;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  /** Miniatura JPEG do vídeo, em base64. */
  thumbnailJpegBase64?: string | null;
  /** Forma de onda da nota de voz. */
  waveform?: Uint8Array | null;
  sizeBytes: number;
}

export interface SendMediaMessageInput {
  sessionId: string;
  tenantId: string;
  to: string;
  /** Id pré-gerado por `createOutboundMessageId` e já persistido pelo chat. */
  messageId: string;
  media: OutboundMedia;
  quotedMessage?: QuotedMessageRef | null;
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
  /**
   * Gera o id que a próxima mensagem da sessão terá no WhatsApp, para o chat gravar antes do
   * envio. Lança `SessionNotConnectedError` sem sessão conectada.
   */
  createOutboundMessageId(sessionId: string): string;
  /**
   * Envia mídia a partir de um arquivo em disco, com o id pré-gerado. Arquivo acima do limite
   * do WhatsApp falha antes de subir (`MediaTooLargeError`).
   */
  sendMediaMessage(input: SendMediaMessageInput): Promise<SendMessageResult>;
  /** Aplica ou remove nossa reação em uma mensagem. `emoji: null` remove. */
  sendReaction(input: SendReactionInput): Promise<SendMessageResult>;
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
  /**
   * Baixa a foto de perfil de um contato ou grupo e devolve uma URL servida por nós.
   *
   * A URL que o WhatsApp fornece é temporária; persisti-la deixaria avatares quebrados
   * depois de algumas horas. Por isso a imagem é armazenada e o retorno é uma URL
   * estável. Devolve null quando não há foto, ela é restrita por privacidade, ou a
   * busca falha.
   *
   * @param jid telefone em dígitos (contato) ou groupJid (grupo, sem @g.us)
   */
  fetchProfilePicture(sessionId: string, jid: string, isGroup: boolean): Promise<string | null>;
  /**
   * Verifica se um telefone tem conta no WhatsApp.
   * Devolve null quando a sessão não está conectada ou a consulta falha — nesse caso
   * não dá para afirmar que o número não existe.
   */
  checkNumberExists(sessionId: string, phone: string): Promise<boolean | null>;
  /**
   * Aplica no WhatsApp uma mudança de estado da conversa.
   *
   * Só expõe o que o protocolo suporta: arquivar, fixar, silenciar e marcar como não
   * lida. Favoritos e listas não têm equivalente e ficam no painel.
   */
  updateChatState(input: UpdateChatStateInput): Promise<void>;
}

export interface UpdateChatStateInput {
  sessionId: string;
  /** Telefone (conversa individual) ou groupJid sem @g.us (grupo). */
  chatId: string;
  isGroup: boolean;
  /** Última mensagem conhecida — exigida pelo protocolo em archive e markRead. */
  lastMessage?: {
    externalId: string;
    fromMe: boolean;
    timestamp: Date;
  };
  archived?: boolean;
  pinned?: boolean;
  /** Duração do silêncio em ms; null remove. */
  muteMs?: number | null;
  /** false marca como não lida. */
  read?: boolean;
}

export interface GroupParticipantInfo {
  /** Telefone em dígitos, ou null quando não revelado pelo participante. */
  phone: string | null;
  /** Nome exibido, quando o WhatsApp o fornece. */
  name: string | null;
  /** Foto de perfil. URL temporária do WhatsApp — não deve ser persistida. */
  avatarUrl: string | null;
  isAdmin: boolean;
}

