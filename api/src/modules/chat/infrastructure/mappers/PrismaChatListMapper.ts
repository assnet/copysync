import type { ChatList as PrismaChatList } from '@prisma/client';
import type { ChatList } from '../../domain/entities/ChatList';

export class PrismaChatListMapper {
  static toDomain(raw: PrismaChatList): ChatList {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      name: raw.name,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
