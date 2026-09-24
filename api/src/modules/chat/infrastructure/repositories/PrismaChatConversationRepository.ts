import type { PrismaClient } from '@prisma/client';
import type {
  ConversationLastMessageUpdate,
  ConversationUpdateData,
  CreateConversationData,
  IChatConversationRepository,
  ConversationStateUpdate,
  ListConversationsFilter,
  ApplyRemoteStateResult,
  AppliedConversationState,
} from '../../domain/contracts/IChatConversationRepository';
import type { RemoteChatState } from '../../../../shared/events/InternalMessagingEvent';
import { diffRemoteState } from '../../domain/services/diffRemoteState';
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

  async applyRemoteState(input: {
    tenantId: string;
    sessionId: string;
    isGroup: boolean;
    chatId: string;
    state: RemoteChatState;
  }): Promise<ApplyRemoteStateResult | null> {
    const { tenantId, sessionId, state } = input;

    // O WhatsApp identifica o chat pelo groupJid ou pelo telefone; aqui o telefone
    // mora no contato.
    let where: { tenantId: string; sessionId: string; groupJid?: string; contactId?: string };
    if (input.isGroup) {
      where = { tenantId, sessionId, groupJid: input.chatId };
    } else {
      const contact = await this.prisma.chatContact.findUnique({
        where: { tenantId_phone: { tenantId, phone: input.chatId } },
        select: { id: true },
      });
      if (!contact) return null;
      where = { tenantId, sessionId, contactId: contact.id };
    }

    const current = await this.prisma.chatConversation.findFirst({
      where,
      select: {
        id: true,
        unreadCount: true,
        manuallyUnread: true,
        archived: true,
        pinned: true,
        mutedUntil: true,
      },
    });
    // O WhatsApp entrega o estado de todos os chats do aparelho e a maioria não tem
    // conversa aqui: ignorar em silêncio é o caminho normal, não um erro.
    if (!current) return null;

    // A regra de comparação mora no domínio, onde é testável sem banco.
    const changed = diffRemoteState(current, state);

    // Estado igual ao persistido: nada a gravar e nada a anunciar. É o que impede o
    // eco do próprio painel de virar gravação e frame de WebSocket.
    if (Object.keys(changed).length === 0) {
      return { conversationId: current.id, changed: {} };
    }

    // Compare-and-set: o listener é assíncrono e um lote de sincronização pode trazer
    // dois eventos do mesmo chat. Sem os valores lidos no where, a segunda gravação
    // sobrescreveria a primeira com dado obsoleto.
    const result = await this.prisma.chatConversation.updateMany({
      where: {
        id: current.id,
        tenantId,
        ...(changed.unreadCount !== undefined ? { unreadCount: current.unreadCount } : {}),
        ...(changed.manuallyUnread !== undefined ? { manuallyUnread: current.manuallyUnread } : {}),
        ...(changed.archived !== undefined ? { archived: current.archived } : {}),
        ...(changed.pinned !== undefined ? { pinned: current.pinned } : {}),
        ...(changed.mutedUntil !== undefined ? { mutedUntil: current.mutedUntil } : {}),
      },
      data: changed,
    });

    // Corrida perdida: quem gravou primeiro já publicou o estado final, e republicar
    // aqui emitiria um valor obsoleto.
    if (result.count === 0) return { conversationId: current.id, changed: {} };

    return { conversationId: current.id, changed };
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
    // A marcação manual sai junto: a conversa foi lida, então continuar destacada
    // como "não lida" contradiz o que o operador acabou de fazer.
    await this.prisma.chatConversation.updateMany({
      where: { id, tenantId },
      data: { unreadCount: 0, manuallyUnread: false },
    });
  }

  async updateGroupAvatarUrlByGroupJid(groupJid: string, tenantId: string, avatarUrl: string): Promise<void> {
    await this.prisma.chatConversation.updateMany({
      where: { tenantId, groupJid, isGroup: true },
      data: { groupAvatarUrl: avatarUrl },
    });
  }
}
