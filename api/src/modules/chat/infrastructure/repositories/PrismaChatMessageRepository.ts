import type { PrismaClient } from '@prisma/client';
import type {
  ChatMessageCreateData,
  IChatMessageRepository,
  ListMessagesFilter,
} from '../../domain/contracts/IChatMessageRepository';
import type { ChatMessage } from '../../domain/entities/ChatMessage';
import { PrismaChatMessageMapper } from '../mappers/PrismaChatMessageMapper';

export class PrismaChatMessageRepository implements IChatMessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string, tenantId: string): Promise<ChatMessage | null> {
    const raw = await this.prisma.chatMessage.findFirst({
      where: { id, tenantId },
    });
    return raw ? PrismaChatMessageMapper.toDomain(raw) : null;
  }

  async findMany(filter: ListMessagesFilter): Promise<ChatMessage[]> {
    const where: Record<string, unknown> = {
      tenantId: filter.tenantId,
      conversationId: filter.conversationId,
    };

    if (filter.before) {
      where['createdAt'] = { lt: new Date(filter.before) };
    }

    const rows = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: filter.limit ?? 50,
    });

    return rows.map(PrismaChatMessageMapper.toDomain);
  }

  async create(data: ChatMessageCreateData): Promise<ChatMessage> {
    const raw = await this.prisma.chatMessage.create({
      data: {
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        direction: data.direction,
        type: data.type,
        content: data.content ?? null,
        mediaUrl: data.mediaUrl ?? null,
        mimeType: data.mimeType ?? null,
        externalMessageId: data.externalMessageId ?? null,
        status: 'SENT',
        sentAt: new Date(),
      },
    });
    return PrismaChatMessageMapper.toDomain(raw);
  }
}
