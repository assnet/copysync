import { Prisma, type PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../../../shared/errors/internal/ResourceErrors';
import type { IOfferDestinationRepository } from '../../domain/contracts/IOfferDestinationRepository';
import type { OfferDestinationView } from '../../domain/entities/OfferDestination';

export class PrismaOfferDestinationRepository implements IOfferDestinationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tenantId: string): Promise<OfferDestinationView[]> {
    const rows = await this.prisma.offerDestination.findMany({
      // conversa também filtrada por tenant: defesa extra contra linha inconsistente
      where: { tenantId, conversation: { tenantId } },
      orderBy: { createdAt: 'asc' },
      select: {
        conversationId: true,
        conversation: {
          select: {
            isGroup: true,
            groupName: true,
            sessionId: true,
            contact: { select: { name: true } },
            session: { select: { name: true } },
          },
        },
      },
    });
    return rows.map((r) => ({
      conversationId: r.conversationId,
      title: (r.conversation.isGroup ? r.conversation.groupName : r.conversation.contact?.name) ?? null,
      isGroup: r.conversation.isGroup,
      sessionId: r.conversation.sessionId,
      sessionName: r.conversation.session?.name ?? null,
    }));
  }

  async replace(tenantId: string, conversationIds: string[]): Promise<void> {
    const unique = [...new Set(conversationIds)];
    try {
      await this.prisma.$transaction([
        this.prisma.offerDestination.deleteMany({ where: { tenantId } }),
        this.prisma.offerDestination.createMany({
          data: unique.map((conversationId) => ({ tenantId, conversationId })),
          skipDuplicates: true,
        }),
      ]);
    } catch (err) {
      // FK: conversa apagada entre a validação e a gravação
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new NotFoundError('Conversation');
      }
      throw err;
    }
  }

  async filterOwnedConversations(tenantId: string, ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const rows = await this.prisma.chatConversation.findMany({
      where: { tenantId, id: { in: unique } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
