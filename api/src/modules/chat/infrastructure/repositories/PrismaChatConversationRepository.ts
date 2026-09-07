import type { PrismaClient } from '@prisma/client';
import type {
  ConversationLastMessageUpdate,
  ConversationUpdateData,
  CreateConversationData,
  IChatConversationRepository,
  ConversationStateUpdate,
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

    if (filter.archived !== undefined) {
      where['archived'] = filter.archived;
    }

    if (filter.unreadOnly) {
      where['unreadCount'] = { gt: 0 };
    }

    if (filter.search) {
      where['OR'] = [
        { lastMessagePreview: { contains: filter.search, mode: 'insensitive' } },
        { groupName: { contains: filter.search, mode: 'insensitive' } },
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
      // Fixadas primeiro, como no WhatsApp Web; o resto por atividade recente.
      orderBy: [{ pinned: 'desc' }, { lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: filter.limit ?? 50,
      skip: filter.offset ?? 0,
    });

    return rows.map(PrismaChatConversationMapper.toDomain);
  }

  async updateState(id: string, tenantId: string, data: ConversationStateUpdate): Promise<ChatConversation> {
    // updateMany filtra por tenant; o findFirst seguinte devolve o registro atualizado.
    await this.prisma.chatConversation.updateMany({
      where: { id, tenantId },
      data: {
        ...(data.archived !== undefined ? { archived: data.archived } : {}),
        ...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
        ...(data.mutedUntil !== undefined ? { mutedUntil: data.mutedUntil } : {}),
        ...(data.favorite !== undefined ? { favorite: data.favorite } : {}),
        ...(data.manuallyUnread !== undefined ? { manuallyUnread: data.manuallyUnread } : {}),
        ...(data.tags !== undefined ? { tags: data.tags } : {}),
        ...(data.unreadCount !== undefined ? { unreadCount: data.unreadCount } : {}),
      },
    });

    const raw = await this.prisma.chatConversation.findFirst({ where: { id, tenantId } });
    if (!raw) throw new Error(`Conversation not found after update: ${id}`);
    return PrismaChatConversationMapper.toDomain(raw);
  }

  async setArchivedByChat(input: {
    tenantId: string;
    sessionId: string;
    isGroup: boolean;
    chatId: string;
    archived: boolean;
  }): Promise<number> {
    if (input.isGroup) {
      const result = await this.prisma.chatConversation.updateMany({
        where: { tenantId: input.tenantId, sessionId: input.sessionId, groupJid: input.chatId },
        data: { archived: input.archived },
      });
      return result.count;
    }

    // Conversa individual: o WhatsApp identifica pelo telefone, que aqui está no contato.
    const contact = await this.prisma.chatContact.findUnique({
      where: { tenantId_phone: { tenantId: input.tenantId, phone: input.chatId } },
      select: { id: true },
    });
    if (!contact) return 0;

    const result = await this.prisma.chatConversation.updateMany({
      where: { tenantId: input.tenantId, sessionId: input.sessionId, contactId: contact.id },
      data: { archived: input.archived },
    });
    return result.count;
  }

  async countArchived(tenantId: string, sessionId?: string): Promise<number> {
    return this.prisma.chatConversation.count({
      where: { tenantId, archived: true, ...(sessionId ? { sessionId } : {}) },
    });
  }

  async create(data: CreateConversationData): Promise<ChatConversation> {
    const raw = await this.prisma.chatConversation.create({
      data: {
        tenantId: data.tenantId,
        sessionId: data.sessionId ?? null,
        contactId: data.contactId ?? null,
        externalChatId: data.externalChatId ?? null,
        channel: data.channel ?? 'whatsapp',
        isGroup: data.isGroup ?? false,
        groupJid: data.groupJid ?? null,
        groupName: data.groupName ?? null,
      },
    });
    return PrismaChatConversationMapper.toDomain(raw);
  }

  async findActiveByContactAndSession(
    contactId: string,
    sessionId: string,
    tenantId: string,
  ): Promise<ChatConversation | null> {
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

  async findActiveByGroupAndSession(
    groupJid: string,
    sessionId: string,
    tenantId: string,
  ): Promise<ChatConversation | null> {
    const raw = await this.prisma.chatConversation.findFirst({
      where: {
        tenantId,
        groupJid,
        sessionId,
        isGroup: true,
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
        ...(data.autoDownloadMedia !== undefined && { autoDownloadMedia: data.autoDownloadMedia }),
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

  async updateGroupAvatarUrlByGroupJid(groupJid: string, tenantId: string, avatarUrl: string): Promise<void> {
    await this.prisma.chatConversation.updateMany({
      where: { tenantId, groupJid, isGroup: true },
      data: { groupAvatarUrl: avatarUrl },
    });
  }
}
