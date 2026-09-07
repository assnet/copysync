// ── Status ────────────────────────────────────────────────────────────────────

/** Status geral de uma conversa */
export type ConversationStatus = 'open' | 'pending' | 'bot' | 'closed' | 'waiting';

/** Tipo do conteúdo de uma mensagem */
export type MessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'document'
  | 'video'
  | 'sticker'
  | 'location'
  | 'vcard'
  | 'call_log'
  | 'event';

/** Direção da mensagem em relação ao operador/sistema */
export type MessageDirection = 'in' | 'out';

/** Status de entrega da mensagem */
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Filtro de exibição na lista de conversas */
export type ConversationFilter = 'all' | 'unread' | 'open' | 'waiting' | 'bot' | 'closed';

// ── Entities ──────────────────────────────────────────────────────────────────

export interface ChatParticipant {
  id: string;
  name: string;
  phone: string;
  avatarUrl?: string | null;
  /** Iniciais para o avatar (ex: "GS") */
  initials: string;
  /** Cor do avatar gerada a partir do nome */
  avatarColor?: string;
}

export interface ChatSessionRef {
  id: string;
  name: string;
  phone: string;
}

/** Preview resumido da mensagem citada (reply), resolvido opcionalmente pela API */
export interface QuotedMessagePreview {
  id: string;
  type: MessageType;
  body: string | null;
  mediaUrl?: string | null;
  direction: MessageDirection;
  isDeleted?: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  type: MessageType;
  direction: MessageDirection;
  body: string | null;
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  durationSeconds?: number | null;
  timestamp: string; // ISO 8601
  status: MessageStatus;
  /** true quando se trata de mensagem de sistema/evento */
  isEvent?: boolean;
  /** Mensagem apagada */
  isDeleted?: boolean;
  /** ID da mensagem citada (reply) */
  quotedMessageId?: string | null;
  /** Preview resolvido da mensagem citada */
  quotedMessage?: QuotedMessagePreview | null;
  /** Telefone do participante que enviou (grupos) */
  fromParticipant?: string | null;
  /** Nome do participante que enviou (grupos) */
  fromParticipantName?: string | null;
  fromParticipantAvatarUrl?: string | null;
}

export interface ChatConversation {
  id: string;
  contact: ChatParticipant;
  session: ChatSessionRef | null;
  status: ConversationStatus;
  unreadCount: number;
  lastMessage: string;
  lastMessageAt: string; // ISO 8601
  tags: string[];
  assignedTo: string | null;
  notes: string;
  queue: string | null;
  /** true = conversa de grupo WhatsApp */
  isGroup?: boolean;
  /** JID do grupo (sem @g.us) */
  groupJid?: string | null;
  /** Nome do grupo */
  groupName?: string | null;
  /** Baixar mídia automaticamente (false = somente ao clicar) */
  autoDownloadMedia?: boolean;
  archived?: boolean;
  pinned?: boolean;
  /** ISO; conversa silenciada até esta data. */
  mutedUntil?: string | null;
  favorite?: boolean;
  manuallyUnread?: boolean;
  /** Listas do painel às quais a conversa pertence. */
  lists?: string[];
}
