import type { ChatMessage as PrismaChatMessage } from '@prisma/client';
import { ChatMessage } from '../../domain/entities/ChatMessage';
import {
  ChatMessageDirection,
  ChatMessageStatus,
  ChatMessageType,
} from '../../domain/enums/ChatMessageEnums';

export class PrismaChatMessageMapper {
  static toDomain(raw: PrismaChatMessage): ChatMessage {
    return new ChatMessage({
      id: raw.id,
      tenantId: raw.tenantId,
      conversationId: raw.conversationId,
      direction: raw.direction as ChatMessageDirection,
      type: raw.type as ChatMessageType,
      content: raw.content,
      mediaUrl: raw.mediaUrl,
      mimeType: raw.mimeType,
      fileName: raw.fileName,
      durationSeconds: raw.durationSeconds,
      externalMessageId: raw.externalMessageId,
      status: raw.status ? (raw.status as ChatMessageStatus) : null,
      isDeleted: raw.isDeleted,
      quotedMessageId: raw.quotedMessageId,
      sentAt: raw.sentAt,
      fromParticipant: raw.fromParticipant,
      fromParticipantName: raw.fromParticipantName,
      createdAt: raw.createdAt,
    });
  }
}
