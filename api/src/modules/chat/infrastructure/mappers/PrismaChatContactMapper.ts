import type { ChatContact as PrismaChatContact } from '@prisma/client';
import { ChatContact } from '../../domain/entities/ChatContact';

export class PrismaChatContactMapper {
  static toDomain(raw: PrismaChatContact): ChatContact {
    return new ChatContact({
      id: raw.id,
      tenantId: raw.tenantId,
      name: raw.name,
      phone: raw.phone,
      avatarUrl: raw.avatarUrl,
      notes: raw.notes,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    });
  }
}
