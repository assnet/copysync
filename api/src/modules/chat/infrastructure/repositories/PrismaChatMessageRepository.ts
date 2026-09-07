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

    // A janela é SEMPRE as `limit` mensagens mais recentes (respeitando o cursor
    // `before`). Paginar com ordem crescente devolveria as mais antigas e as
    // mensagens novas nunca apareceriam em conversas com mais de `limit` itens.
    const rows = await this.prisma.chatMessage.findMany({
      where,
      orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
      take: filter.limit ?? 50,
    });

    // `orderDir` controla apenas a ordem do resultado: 'asc' devolve a janela em
    // ordem cronológica (usada pelo painel), 'desc' mantém a mais recente primeiro.
    const ordered = (filter.orderDir ?? 'asc') === 'asc' ? rows.reverse() : rows;

    return ordered.map(PrismaChatMessageMapper.toDomain);
  }

  async create(data: ChatMessageCreateData): Promise<ChatMessage> {
    let quotedMessageId: string | null = null;

    if (data.quotedMessageId) {
      const quotedMessage = await this.prisma.chatMessage.findFirst({
        where: {
          tenantId: data.tenantId,
          OR: [
            { id: data.quotedMessageId },
            { externalMessageId: data.quotedMessageId },
          ],
        },
        select: { id: true },
      });

      quotedMessageId = quotedMessage?.id ?? null;
    }

    const raw = await this.prisma.chatMessage.create({
      data: {
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        direction: data.direction,
        type: data.type,
        content: data.content ?? null,
        mediaUrl: data.mediaUrl ?? null,
        mimeType: data.mimeType ?? null,
        fileName: data.fileName ?? null,
        durationSeconds: data.durationSeconds ?? null,
        externalMessageId: data.externalMessageId ?? null,
        isDeleted: data.isDeleted ?? false,
        quotedMessageId,
        fromParticipant: data.fromParticipant ?? null,
        fromParticipantName: data.fromParticipantName ?? null,
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
