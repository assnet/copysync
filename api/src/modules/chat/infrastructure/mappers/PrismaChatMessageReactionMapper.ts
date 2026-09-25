import type { ChatMessageReaction as PrismaChatMessageReaction } from '@prisma/client';
import type { ChatMessageReaction } from '../../domain/entities/ChatMessageReaction';

export class PrismaChatMessageReactionMapper {
  static toDomain(raw: PrismaChatMessageReaction): ChatMessageReaction {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      messageId: raw.messageId,
      emoji: raw.emoji,
      reactorKey: raw.reactorKey,
      reactorPhone: raw.reactorPhone,
      reactorName: raw.reactorName,
      fromMe: raw.fromMe,
      externalId: raw.externalId,
      reactedAt: raw.reactedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
