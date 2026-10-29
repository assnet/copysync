import type { PrismaClient } from '@prisma/client';
import type {
  ILinkRotationSessionReader,
  LinkRotationSessionRef,
} from '../../domain/contracts/ILinkRotationSessionReader';

const SELECT = { id: true, name: true, status: true } as const;

/** Sessões do tenant (sem as excluídas) para o rodízio. Sempre com `tenantId`. */
export class PrismaLinkRotationSessionReader implements ILinkRotationSessionReader {
  constructor(private readonly prisma: PrismaClient) {}

  async listByTenant(tenantId: string): Promise<LinkRotationSessionRef[]> {
    const rows = await this.prisma.session.findMany({
      where: { tenantId, deletedAt: null },
      select: SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, status: r.status }));
  }

  async findById(tenantId: string, sessionId: string): Promise<LinkRotationSessionRef | null> {
    const r = await this.prisma.session.findFirst({ where: { id: sessionId, tenantId, deletedAt: null }, select: SELECT });
    return r ? { id: r.id, name: r.name, status: r.status } : null;
  }
}
