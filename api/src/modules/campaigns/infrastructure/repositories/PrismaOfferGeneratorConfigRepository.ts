import { Prisma, type PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import type {
  IOfferGeneratorConfigRepository,
  SaveOfferGeneratorConfigInput,
  SessionGroupConversation,
} from '../../domain/contracts/IOfferGeneratorConfigRepository';
import type { OfferDestinationView } from '../../domain/entities/OfferDestination';
import type { OfferGeneratorConfig, OfferSessionRef } from '../../domain/entities/OfferGeneratorConfig';

/** `OfferGeneratorConfig` + `OfferDestination` (grupos). Toda consulta filtra por `tenantId`. */
export class PrismaOfferGeneratorConfigRepository implements IOfferGeneratorConfigRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(tenantId: string): Promise<OfferGeneratorConfig | null> {
    const row = await this.prisma.offerGeneratorConfig.findUnique({ where: { tenantId } });
    return row
      ? {
          tenantId: row.tenantId,
          sessionId: row.sessionId,
          intervalMinSeconds: row.intervalMinSeconds,
          intervalMaxSeconds: row.intervalMaxSeconds,
          updatedAt: row.updatedAt,
        }
      : null;
  }

  async listGroups(tenantId: string): Promise<OfferDestinationView[]> {
    const rows = await this.prisma.offerDestination.findMany({
      // conversa também filtrada por tenant: defesa extra contra linha inconsistente
      where: { tenantId, conversation: { tenantId } },
      orderBy: { createdAt: 'asc' },
      select: {
        conversationId: true,
        conversation: { select: { isGroup: true, groupName: true, groupAvatarUrl: true, sessionId: true } },
      },
    });
    return rows.map((r) => ({
      conversationId: r.conversationId,
      title: r.conversation.groupName ?? null,
      avatarUrl: r.conversation.groupAvatarUrl ?? null,
      isGroup: r.conversation.isGroup,
      sessionId: r.conversation.sessionId,
    }));
  }

  async save(input: SaveOfferGeneratorConfigInput): Promise<void> {
    const { tenantId, sessionId, intervalMinSeconds, intervalMaxSeconds } = input;
    const unique = [...new Set(input.conversationIds)];
    try {
      await this.prisma.$transaction([
        this.prisma.offerGeneratorConfig.upsert({
          where: { tenantId },
          create: { tenantId, sessionId, intervalMinSeconds, intervalMaxSeconds },
          update: { sessionId, intervalMinSeconds, intervalMaxSeconds },
        }),
        this.prisma.offerDestination.deleteMany({ where: { tenantId } }),
        this.prisma.offerDestination.createMany({
          data: unique.map((conversationId) => ({ tenantId, conversationId })),
          skipDuplicates: true,
        }),
      ]);
    } catch (err) {
      // FK: sessão/conversa apagada entre a validação e a gravação
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new NotFoundError('Session or conversation');
      }
      throw err;
    }
  }

  async findSession(tenantId: string, sessionId: string): Promise<OfferSessionRef | null> {
    const row = await this.prisma.session.findFirst({
      where: { id: sessionId, tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    return row ? { id: row.id, status: row.status } : null;
  }

  async listSessionGroupConversations(tenantId: string, sessionId: string): Promise<SessionGroupConversation[]> {
    const rows = await this.prisma.chatConversation.findMany({
      where: { tenantId, sessionId, isGroup: true, groupJid: { not: null }, status: { not: 'CLOSED' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, groupJid: true, groupName: true, groupAvatarUrl: true },
    });
    return rows.map((r) => ({ conversationId: r.id, groupJid: r.groupJid!, title: r.groupName, avatarUrl: r.groupAvatarUrl }));
  }

  async filterSessionGroups(tenantId: string, sessionId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const rows = await this.prisma.chatConversation.findMany({
      where: { tenantId, sessionId, isGroup: true, id: { in: unique } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
