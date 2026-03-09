import type { ChatContact } from '../entities/ChatContact';

export interface ChatContactCreateData {
  tenantId: string;
  name: string;
  phone: string;
  avatarUrl?: string | null;
  notes?: string | null;
}

export interface IChatContactRepository {
  findById(id: string, tenantId: string): Promise<ChatContact | null>;
  findByPhone(phone: string, tenantId: string): Promise<ChatContact | null>;
  findOrCreate(data: ChatContactCreateData): Promise<ChatContact>;
  upsert(data: ChatContactCreateData): Promise<ChatContact>;
}
