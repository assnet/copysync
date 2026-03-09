// ── Status ────────────────────────────────────────────────────────────────────

/** Status geral de uma conversa */
export type ConversationStatus = 'open' | 'pending' | 'bot' | 'closed' | 'waiting';

/** Tipo do conteúdo de uma mensagem */
export type MessageType = 'text' | 'image' | 'audio' | 'document' | 'event' | 'sticker';

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

export interface ChatMessage {
  id: string;
  conversationId: string;
  type: MessageType;
  direction: MessageDirection;
  body: string;
  mediaUrl?: string | null;
  fileName?: string | null;
  durationSeconds?: number | null;
  timestamp: string; // ISO 8601
  status: MessageStatus;
  /** true quando se trata de mensagem de sistema/evento */
  isEvent?: boolean;
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
}
