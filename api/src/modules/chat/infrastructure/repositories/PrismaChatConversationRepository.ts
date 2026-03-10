import type { PrismaClient } from '@prisma/client';
import type {
  ConversationLastMessageUpdate,
  ConversationUpdateData,
  IChatConversationRepository,
  ListConversationsFilter,
} from '../../domain/contracts/IChatConversationRepository';
import type { ChatConversation } from '../../domain/entities/ChatConversation';
import { PrismaChatConversationMapper } from '../mappers/PrismaChatConversationMapper';

export class PrismaChatConversationRepository implements IChatConversationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string, tenantId: string): Promise<ChatConversation | null> {
    const raw = await this.prisma.chatConversation.findFirst({
      where: { id, tenantId },
    });
    return raw ? PrismaChatConversationMapper.toDomain(raw) : null;
  }

  async findMany(filter: ListConversationsFilter): Promise<ChatConversation[]> {
    const where: Record<string, unknown> = { tenantId: filter.tenantId };

    if (filter.status) {
      where['status'] = filter.status;
    }

    if (filter.sessionId) {
      where['sessionId'] = filter.sessionId;
    }

    if (filter.unreadOnly) {
      where['unreadCount'] = { gt: 0 };
    }

    if (filter.search) {
      // Pesquisa por preview ou pelo contato (feita via join inline)
      // Usamos OR com condições no próprio campo lastMessagePreview e filtramos por contato externamente
      where['OR'] = [
        { lastMessagePreview: { contains: filter.search, mode: 'insensitive' } },
        {
          contact: {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { phone: { contains: filter.search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const rows = await this.prisma.chatConversation.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
    });

    return rows.map(PrismaChatConversationMapper.toDomain);
  }

  async create(data: {
    tenantId: string;
    sessionId?: string | null;
    contactId: string;
    externalChatId?: string | null;
    channel?: string;
  }): Promise<ChatConversation> {
    const raw = await this.prisma.chatConversation.create({
      data: {
        tenantId: data.tenantId,
        sessionId: data.sessionId ?? null,
        contactId: data.contactId,
        externalChatId: data.externalChatId ?? null,
        channel: data.channel ?? 'whatsapp',
      },
    });
    return PrismaChatConversationMapper.toDomain(raw);
  }

  async findActiveByContactAndSession(
    contactId: string,
    sessionId: string,
    tenantId: string,
  ): Promise<import('../../domain/entities/ChatConversation').ChatConversation | null> {
    const raw = await this.prisma.chatConversation.findFirst({
      where: {
        tenantId,
        contactId,
        sessionId,
        status: { notIn: ['CLOSED'] },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
    return raw ? PrismaChatConversationMapper.toDomain(raw) : null;
  }

  async update(
    id: string,
    tenantId: string,
    data: ConversationUpdateData,
  ): Promise<ChatConversation> {
    const raw = await this.prisma.chatConversation.update({
      where: { id },
      data: {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.assignedUserId !== undefined && { assignedUserId: data.assignedUserId }),
        ...(data.queueName !== undefined && { queueName: data.queueName }),
        ...(data.tags !== undefined && { tags: data.tags }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    });

    if (raw.tenantId !== tenantId) {
      throw new Error('Conversation does not belong to tenant');
    }

    return PrismaChatConversationMapper.toDomain(raw);
  }

  async updateLastMessage(
    id: string,
    tenantId: string,
    data: ConversationLastMessageUpdate,
  ): Promise<void> {
    await this.prisma.chatConversation.updateMany({
      where: { id, tenantId },
      data: {
        lastMessagePreview: data.lastMessagePreview,
        lastMessageAt: data.lastMessageAt,
      },
    });
  }

  async incrementUnread(id: string, tenantId: string): Promise<void> {
    await this.prisma.chatConversation.updateMany({
      where: { id, tenantId },
      data: { unreadCount: { increment: 1 } },
    });
  }

  async resetUnread(id: string, tenantId: string): Promise<void> {
    await this.prisma.chatConversation.updateMany({
      where: { id, tenantId },
      data: { unreadCount: 0 },
    });
  }
}
