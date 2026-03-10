import type { ChatMessage } from '../entities/ChatMessage';
import type { ChatMessageDirection, ChatMessageType } from '../enums/ChatMessageEnums';

export interface ListMessagesFilter {
  tenantId: string;
  conversationId: string;
  limit?: number;
  before?: string; // ISO date — para paginação por cursor
}

export interface ChatMessageCreateData {
  tenantId: string;
  conversationId: string;
  direction: ChatMessageDirection;
  type: ChatMessageType;
  content?: string | null;
  mediaUrl?: string | null;
  mimeType?: string | null;
  externalMessageId?: string | null;
}

export interface IChatMessageRepository {
  findById(id: string, tenantId: string): Promise<ChatMessage | null>;
  findByExternalId(externalId: string, tenantId: string): Promise<ChatMessage | null>;
  findMany(filter: ListMessagesFilter): Promise<ChatMessage[]>;
  create(data: ChatMessageCreateData): Promise<ChatMessage>;
}
