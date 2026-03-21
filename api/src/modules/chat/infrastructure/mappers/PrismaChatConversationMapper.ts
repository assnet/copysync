import type { ChatConversation as PrismaChatConversation } from '@prisma/client';
import { ChatConversation } from '../../domain/entities/ChatConversation';
import { ConversationStatus } from '../../domain/enums/ConversationStatus';

export class PrismaChatConversationMapper {
  static toDomain(raw: PrismaChatConversation): ChatConversation {
    return new ChatConversation({
      id: raw.id,
      tenantId: raw.tenantId,
      sessionId: raw.sessionId,
      contactId: raw.contactId,
      externalChatId: raw.externalChatId,
      channel: raw.channel,
      status: raw.status as ConversationStatus,
      unreadCount: raw.unreadCount,
      lastMessageAt: raw.lastMessageAt,
      lastMessagePreview: raw.lastMessagePreview,
      assignedUserId: raw.assignedUserId,
      queueName: raw.queueName,
      tags: raw.tags,
      notes: raw.notes,
      isGroup: raw.isGroup,
      groupJid: raw.groupJid,
      groupName: raw.groupName,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }
}
