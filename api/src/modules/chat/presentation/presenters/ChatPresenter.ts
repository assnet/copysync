import type { ConversationListItemDto } from '../../application/use-cases/ListConversationsUseCase';
import type { ChatMessageDto } from '../../application/use-cases/ListMessagesUseCase';
import type { ChatContactDto } from '../../application/use-cases/GetContactByIdUseCase';

export class ChatPresenter {
  static presentConversation(dto: ConversationListItemDto): object {
    return {
      id: dto.id,
      tenantId: dto.tenantId,
      sessionId: dto.sessionId,
      contactId: dto.contactId,
      channel: dto.channel,
      status: dto.status,
      unreadCount: dto.unreadCount,
      lastMessageAt: dto.lastMessageAt,
      lastMessagePreview: dto.lastMessagePreview,
      assignedUserId: dto.assignedUserId,
      queueName: dto.queueName,
      tags: dto.tags,
      notes: dto.notes,
      createdAt: dto.createdAt,
      updatedAt: dto.updatedAt,
      contact: dto.contact,
      session: dto.session,
      assignedUser: dto.assignedUser,
    };
  }

  static presentConversationList(dtos: ConversationListItemDto[]): object[] {
    return dtos.map(ChatPresenter.presentConversation);
  }

  static presentMessage(dto: ChatMessageDto): object {
    return {
      id: dto.id,
      conversationId: dto.conversationId,
      direction: dto.direction,
      type: dto.type,
      content: dto.content,
      mediaUrl: dto.mediaUrl,
      mimeType: dto.mimeType,
      fileName: dto.fileName,
      durationSeconds: dto.durationSeconds,
      status: dto.status,
      isDeleted: dto.isDeleted,
      quotedMessageId: dto.quotedMessageId,
      quotedMessage: dto.quotedMessage ?? null,
      sentAt: dto.sentAt,
      createdAt: dto.createdAt,
    };
  }

  static presentMessageList(dtos: ChatMessageDto[]): object[] {
    return dtos.map(ChatPresenter.presentMessage);
  }

  static presentContact(dto: ChatContactDto): object {
    return {
      id: dto.id,
      name: dto.name,
      phone: dto.phone,
      avatarUrl: dto.avatarUrl,
      notes: dto.notes,
      initials: dto.initials,
      createdAt: dto.createdAt,
      updatedAt: dto.updatedAt,
    };
  }
}
