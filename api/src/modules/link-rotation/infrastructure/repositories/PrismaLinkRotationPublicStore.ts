import type { PrismaClient } from '@prisma/client';
import type {
  ILinkRotationPublicStore,
  LinkRotationPublicLabels,
} from '../../domain/contracts/ILinkRotationPublicStore';

/** Leituras/escritas da rota pública. Sempre com `tenantId` da rotação resolvida. */
export class PrismaLinkRotationPublicStore implements ILinkRotationPublicStore {
  constructor(private readonly prisma: PrismaClient) {}

  /** Usa o índice (rotationId, createdAt). */
  async hasRecentClick(tenantId: string, rotationId: string, ipHash: string, since: Date): Promise<boolean> {
    const row = await this.prisma.linkClick.findFirst({
      where: { tenantId, rotationId, ipHash, createdAt: { gte: since } },
      select: { id: true },
    });
    return !!row;
  }

  async markAllFullNotified(tenantId: string, rotationId: string, at: Date, staleBefore: Date): Promise<boolean> {
    const { count } = await this.prisma.linkRotation.updateMany({
      where: {
        id: rotationId,
        tenantId,
        OR: [{ allFullNotifiedAt: null }, { allFullNotifiedAt: { lt: staleBefore } }],
      },
      data: { allFullNotifiedAt: at },
    });
    return count > 0;
  }

  async findLabels(tenantId: string, sessionId: string, conversationId: string | null): Promise<LinkRotationPublicLabels> {
    const [session, conversation] = await Promise.all([
      this.prisma.session.findFirst({ where: { id: sessionId, tenantId }, select: { name: true } }),
      conversationId
        ? this.prisma.chatConversation.findFirst({ where: { id: conversationId, tenantId }, select: { groupName: true } })
        : Promise.resolve(null),
    ]);
    return { sessionName: session?.name ?? null, groupName: conversation?.groupName ?? null };
  }
}
