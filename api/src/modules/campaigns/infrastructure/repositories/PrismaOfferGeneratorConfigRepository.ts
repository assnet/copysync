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
    const row = await this.prisma.offerGeneratorConfig.findUnique({
      where: { tenantId },
      // Sessão apagada (soft delete) segue na tabela até o próximo salvar: não faz parte da configuração lida
      include: { sessions: { where: { session: { tenantId, deletedAt: null } }, orderBy: { position: 'asc' }, select: { sessionId: true } } },
    });
    return row
      ? {
          tenantId: row.tenantId,
          sessionIds: row.sessions.map((s) => s.sessionId),
          intervalMinSeconds: row.intervalMinSeconds,
          intervalMaxSeconds: row.intervalMaxSeconds,
          dispatchOrder: row.dispatchOrder,
          windowStartMinute: row.windowStartMinute,
          windowEndMinute: row.windowEndMinute,
          weekdaysMask: row.weekdaysMask,
          updatedAt: row.updatedAt,
        }
      : null;
  }

  async listGroups(tenantId: string): Promise<OfferDestinationView[]> {
    const rows = await this.prisma.offerDestination.findMany({
      // conversa também filtrada por tenant: defesa extra contra linha inconsistente.
      // Grupo de sessão apagada não é destino (a linha fica até o próximo salvar)
      where: { tenantId, conversation: { tenantId, session: { tenantId, deletedAt: null } } },
      // Ordem de envio escolhida no assistente; desempate estável para linhas antigas
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { conversationId: 'asc' }],
      select: {
        conversationId: true,
        conversation: { select: { isGroup: true, groupName: true, groupAvatarUrl: true, sessionId: true, groupJid: true } },
      },
    });
    return rows.map((r) => ({
      conversationId: r.conversationId,
      title: r.conversation.groupName ?? null,
      avatarUrl: r.conversation.groupAvatarUrl ?? null,
      isGroup: r.conversation.isGroup,
      sessionId: r.conversation.sessionId,
      groupJid: r.conversation.groupJid ?? null,
    }));
  }

  async save(input: SaveOfferGeneratorConfigInput): Promise<void> {
    const { tenantId, intervalMinSeconds, intervalMaxSeconds, dispatchOrder, windowStartMinute, windowEndMinute, weekdaysMask } = input;
    const sessionIds = [...new Set(input.sessionIds)];
    const unique = [...new Set(input.conversationIds)];
    // `sessionId` legado = primeira sessão, só para leitores antigos; a lista é a fonte de verdade
    const sessionId = sessionIds[0] ?? null;
    try {
      await this.prisma.$transaction([
        this.prisma.offerGeneratorConfig.upsert({
          where: { tenantId },
          create: { tenantId, sessionId, intervalMinSeconds, intervalMaxSeconds, dispatchOrder, windowStartMinute, windowEndMinute, weekdaysMask },
          update: { sessionId, intervalMinSeconds, intervalMaxSeconds, dispatchOrder, windowStartMinute, windowEndMinute, weekdaysMask },
        }),
        this.prisma.offerGeneratorConfigSession.deleteMany({ where: { tenantId } }),
        this.prisma.offerGeneratorConfigSession.createMany({
          data: sessionIds.map((sid, position) => ({ tenantId, sessionId: sid, position })),
        }),
        this.prisma.offerDestination.deleteMany({ where: { tenantId } }),
        this.prisma.offerDestination.createMany({
          data: unique.map((conversationId, position) => ({ tenantId, conversationId, position })),
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
      select: { id: true, status: true, engine: true },
    });
    return row ? { id: row.id, status: row.status, engine: row.engine } : null;
  }

  async listSessionGroupConversations(tenantId: string, sessionId: string): Promise<SessionGroupConversation[]> {
    const rows = await this.prisma.chatConversation.findMany({
      where: { tenantId, sessionId, isGroup: true, groupJid: { not: null }, status: { not: 'CLOSED' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, groupJid: true, groupName: true, groupAvatarUrl: true },
    });
    return rows.map((r) => ({ conversationId: r.id, groupJid: r.groupJid!, title: r.groupName, avatarUrl: r.groupAvatarUrl }));
  }

  async findSessions(tenantId: string, sessionIds: string[]): Promise<OfferSessionRef[]> {
    const unique = [...new Set(sessionIds)];
    if (unique.length === 0) return [];
    const rows = await this.prisma.session.findMany({
      where: { id: { in: unique }, tenantId, deletedAt: null },
      select: { id: true, status: true, engine: true },
    });
    const byId = new Map(rows.map((r) => [r.id, { id: r.id, status: r.status, engine: r.engine }]));
    return unique.flatMap((id) => byId.get(id) ?? []);
  }

  async filterSessionGroups(tenantId: string, sessionIds: string[], ids: string[]): Promise<{ conversationId: string; sessionId: string; groupJid: string | null }[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0 || sessionIds.length === 0) return [];
    const rows = await this.prisma.chatConversation.findMany({
      where: { tenantId, sessionId: { in: sessionIds }, isGroup: true, id: { in: unique } },
      select: { id: true, sessionId: true, groupJid: true },
    });
    return rows.flatMap((r) => (r.sessionId ? [{ conversationId: r.id, sessionId: r.sessionId, groupJid: r.groupJid }] : []));
  }
}
