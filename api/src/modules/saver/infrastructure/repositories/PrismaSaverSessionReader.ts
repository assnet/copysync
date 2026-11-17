import type { PrismaClient } from '@prisma/client';
import type { ISaverSessionReader, SaverSessionRef } from '../../domain/contracts/ISaverSessionReader';

/** Sessão do tenant para o Saver. Sempre com `tenantId`; excluída (`deletedAt`) não aparece. */
export class PrismaSaverSessionReader implements ISaverSessionReader {
  constructor(private readonly prisma: Pick<PrismaClient, 'session'>) {}

  async findById(tenantId: string, sessionId: string): Promise<SaverSessionRef | null> {
    const r = await this.prisma.session.findFirst({
      where: { id: sessionId, tenantId, deletedAt: null },
      select: { id: true, status: true, engine: true },
    });
    return r ? { id: r.id, status: r.status, engine: r.engine } : null;
  }
}
