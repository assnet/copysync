import type { PrismaClient } from '@prisma/client';
import type {
  ILinkRotationGroupCatalog,
  LinkRotationGroupCandidate,
} from '../../domain/contracts/ILinkRotationGroupCatalog';

/** Conversas de grupo (`isGroup` com `groupJid`) do tenant. Sempre com `tenantId`. */
export class PrismaLinkRotationGroupCatalog implements ILinkRotationGroupCatalog {
  constructor(private readonly prisma: PrismaClient) {}

  async findGroups(tenantId: string, conversationIds: readonly string[]): Promise<LinkRotationGroupCandidate[]> {
    if (conversationIds.length === 0) return [];
    const rows = await this.prisma.chatConversation.findMany({
      where: { tenantId, id: { in: [...new Set(conversationIds)] }, isGroup: true, groupJid: { not: null } },
      select: { id: true, sessionId: true, groupJid: true, groupName: true },
    });
    return rows.map((r) => ({
      conversationId: r.id,
      sessionId: r.sessionId,
      groupJid: r.groupJid!,
      name: r.groupName,
    }));
  }
}
