import type { ChatConversation } from '../entities/ChatConversation';
import type { ConversationStatus } from '../enums/ConversationStatus';

export interface ListConversationsFilter {
  tenantId: string;
  search?: string;
  status?: ConversationStatus;
  sessionId?: string;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface ConversationUpdateData {
  status?: ConversationStatus;
  assignedUserId?: string | null;
  queueName?: string | null;
  tags?: string[];
  notes?: string | null;
  autoDownloadMedia?: boolean;
}

export interface ConversationLastMessageUpdate {
  lastMessagePreview: string;
  lastMessageAt: Date;
}

export interface CreateConversationData {
  tenantId: string;
  sessionId?: string | null;
  /** null para conversas de grupo */
  contactId?: string | null;
  externalChatId?: string | null;
  channel?: string;
  isGroup?: boolean;
  groupJid?: string | null;
  groupName?: string | null;
}

export interface IChatConversationRepository {
  findById(id: string, tenantId: string): Promise<ChatConversation | null>;
  findMany(filter: ListConversationsFilter): Promise<ChatConversation[]>;
  /**
   * Returns the most recent non-CLOSED conversation for a given contact+session pair.
   * Used when ingesting incoming messages to continue an existing conversation.
   */
  findActiveByContactAndSession(
    contactId: string,
    sessionId: string,
    tenantId: string,
  ): Promise<ChatConversation | null>;
  /**
   * Returns the most recent non-CLOSED group conversation for a given groupJid+session pair.
   */
  findActiveByGroupAndSession(
    groupJid: string,
    sessionId: string,
    tenantId: string,
  ): Promise<ChatConversation | null>;
  create(data: CreateConversationData): Promise<ChatConversation>;
  update(id: string, tenantId: string, data: ConversationUpdateData): Promise<ChatConversation>;
  updateLastMessage(
    id: string,
    tenantId: string,
    data: ConversationLastMessageUpdate,
  ): Promise<void>;
  incrementUnread(id: string, tenantId: string): Promise<void>;
  resetUnread(id: string, tenantId: string): Promise<void>;
  /** Atualiza apenas groupAvatarUrl de todas as conversações do grupo (sem tocar outros campos). */
  updateGroupAvatarUrlByGroupJid(groupJid: string, tenantId: string, avatarUrl: string): Promise<void>;
}
