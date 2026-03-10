import type { ChatMessage } from '../entities/ChatMessage';
import type { ChatMessageDirection, ChatMessageStatus, ChatMessageType } from '../enums/ChatMessageEnums';

export interface ListMessagesFilter {
  tenantId: string;
  conversationId: string;
  limit?: number;
  before?: string; // ISO date — para paginação por cursor
  /** 'asc' (padrão) exibe do mais antigo; 'desc' do mais recente */
  orderDir?: 'asc' | 'desc';
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
  /** Timestamp real da mensagem; se omitido, usa new Date() */
  sentAt?: Date | null;
}

export interface IChatMessageRepository {
  findById(id: string, tenantId: string): Promise<ChatMessage | null>;
  findByExternalId(externalId: string, tenantId: string): Promise<ChatMessage | null>;
  findMany(filter: ListMessagesFilter): Promise<ChatMessage[]>;
  create(data: ChatMessageCreateData): Promise<ChatMessage>;
  updateStatusByExternalId(
    externalId: string,
    tenantId: string,
    status: ChatMessageStatus,
  ): Promise<ChatMessage | null>;
}
