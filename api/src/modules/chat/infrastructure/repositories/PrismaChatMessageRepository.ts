import type { PrismaClient } from '@prisma/client';
import type {
  ChatMessageCreateData,
  IChatMessageRepository,
  ListMessagesFilter,
} from '../../domain/contracts/IChatMessageRepository';
import type { ChatMessage } from '../../domain/entities/ChatMessage';
import type { ChatMessageStatus } from '../../domain/enums/ChatMessageEnums';
import { PrismaChatMessageMapper } from '../mappers/PrismaChatMessageMapper';

export class PrismaChatMessageRepository implements IChatMessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string, tenantId: string): Promise<ChatMessage | null> {
    const raw = await this.prisma.chatMessage.findFirst({
      where: { id, tenantId },
    });
    return raw ? PrismaChatMessageMapper.toDomain(raw) : null;
  }

  async findByExternalId(externalId: string, tenantId: string): Promise<ChatMessage | null> {
    const raw = await this.prisma.chatMessage.findFirst({
      where: { externalMessageId: externalId, tenantId },
    });
    return raw ? PrismaChatMessageMapper.toDomain(raw) : null;
  }

  async findMany(filter: ListMessagesFilter): Promise<ChatMessage[]> {
    const where: Record<string, unknown> = {
      tenantId: filter.tenantId,
      conversationId: filter.conversationId,
    };

    if (filter.before) {
      where['sentAt'] = { lt: new Date(filter.before) };
    }

    const dir = filter.orderDir ?? 'asc';
    const rows = await this.prisma.chatMessage.findMany({
      where,
      orderBy: [{ sentAt: dir }, { createdAt: dir }],
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
        sentAt: data.sentAt ?? new Date(),
      },
    });
    return PrismaChatMessageMapper.toDomain(raw);
  }

  async updateStatusByExternalId(
    externalId: string,
    tenantId: string,
    status: ChatMessageStatus,
  ): Promise<ChatMessage | null> {
    const existing = await this.prisma.chatMessage.findFirst({
      where: { externalMessageId: externalId, tenantId },
    });
    if (!existing) return null;

    const raw = await this.prisma.chatMessage.update({
      where: { id: existing.id },
      data: { status },
    });
    return PrismaChatMessageMapper.toDomain(raw);
  }
}
