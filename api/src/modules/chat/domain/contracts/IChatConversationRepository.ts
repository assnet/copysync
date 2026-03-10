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
}

export interface ConversationLastMessageUpdate {
  lastMessagePreview: string;
  lastMessageAt: Date;
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
  create(data: {
    tenantId: string;
    sessionId?: string | null;
    contactId: string;
    externalChatId?: string | null;
    channel?: string;
  }): Promise<ChatConversation>;
  update(id: string, tenantId: string, data: ConversationUpdateData): Promise<ChatConversation>;
  updateLastMessage(
    id: string,
    tenantId: string,
    data: ConversationLastMessageUpdate,
  ): Promise<void>;
  incrementUnread(id: string, tenantId: string): Promise<void>;
  resetUnread(id: string, tenantId: string): Promise<void>;
}
