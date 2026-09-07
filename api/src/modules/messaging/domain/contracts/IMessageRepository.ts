import type { Message } from '../entities/Message';
import type { MessageStatus } from '../entities/Message';

export interface FindMessagesFilter {
  tenantId: string;
  sessionId?: string;
  from?: string;
  status?: MessageStatus;
  limit?: number;
  offset?: number;
}

export interface IMessageRepository {
  findById(id: string, tenantId: string): Promise<Message | null>;
  findMany(filter: FindMessagesFilter): Promise<Message[]>;
  create(message: Message): Promise<Message>;
  updateStatus(id: string, tenantId: string, status: MessageStatus): Promise<void>;
}
