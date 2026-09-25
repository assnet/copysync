import type { PrismaClient } from '@prisma/client';
import type {
  ChatMessageCreateData,
  FailedPendingMessage,
  FailPendingInput,
  FindAroundInput,
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

    if (filter.search) {
      // Mensagens sem texto (mídia pura) simplesmente não casam com a busca.
      where['content'] = { contains: filter.search, mode: 'insensitive' };
      where['isDeleted'] = false;
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

  async findAround(input: FindAroundInput): Promise<ChatMessage[]> {
    const anchor = await this.prisma.chatMessage.findFirst({
      where: { id: input.messageId, tenantId: input.tenantId, conversationId: input.conversationId },
      select: { id: true, sentAt: true, createdAt: true },
    });
    if (!anchor) return [];

    const pivot = anchor.sentAt ?? anchor.createdAt;
    const half = Math.max(1, Math.floor(input.limit / 2));
    const base = { tenantId: input.tenantId, conversationId: input.conversationId };

    // Duas consultas: as anteriores em ordem decrescente (para pegar as mais próximas
    // da âncora) e as seguintes em ordem crescente.
    const [before, after] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where: { ...base, sentAt: { lt: pivot } },
        orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
        take: half,
      }),
      this.prisma.chatMessage.findMany({
        where: { ...base, sentAt: { gte: pivot } },
        orderBy: [{ sentAt: 'asc' }, { createdAt: 'asc' }],
        take: half,
      }),
    ]);

    return [...before.reverse(), ...after].map(PrismaChatMessageMapper.toDomain);
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
        status: data.status ?? 'SENT',
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

  async transitionStatus(
    id: string,
    tenantId: string,
    from: ChatMessageStatus[],
    to: ChatMessageStatus,
    sentAt?: Date,
  ): Promise<ChatMessage | null> {
    // A condição no WHERE torna a troca atômica: quem chegar depois não sobrescreve.
    const { count } = await this.prisma.chatMessage.updateMany({
      where: { id, tenantId, status: { in: from } },
      data: { status: to, ...(sentAt ? { sentAt } : {}) },
    });
    if (count !== 1) return null;
    return this.findById(id, tenantId);
  }

  async failPending(input: FailPendingInput): Promise<FailedPendingMessage[]> {
    // Sem `tenantId` de propósito: varredura do processo sobre todos os tenants
    // (boot e rotina periódica), exceção explícita ao AGENTS.md §36.8. Não expor em rota.
    const select = { id: true, tenantId: true, conversationId: true } as const;
    const candidates = await this.prisma.chatMessage.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: input.olderThan },
        ...(input.excludeIds?.length ? { id: { notIn: input.excludeIds } } : {}),
      },
      select,
    });
    if (candidates.length === 0) return [];

    const ids = candidates.map((c) => c.id);
    const { count } = await this.prisma.chatMessage.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'FAILED' },
    });
    if (count === ids.length) return candidates;

    // Parte saiu de PENDING entre a leitura e a escrita (despacho ou recibo): devolve só
    // as que ficaram FAILED. Uma que o despacho falhou no intervalo pode vir junto; a
    // publicação de status é idempotente.
    return this.prisma.chatMessage.findMany({
      where: { id: { in: ids }, status: 'FAILED' },
      select,
    });
  }
}
