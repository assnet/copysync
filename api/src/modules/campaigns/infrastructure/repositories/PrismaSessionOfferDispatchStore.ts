import type { PrismaClient } from '@prisma/client';
import { SESSION_DELETED_REASON } from '../../domain/offerDispatchReasons';

/**
 * Recurso preso à sessão (`SessionLinkedResources` do `DeleteSessionUseCase`, lista `afterDelete`: roda
 * depois do soft delete, quando o claim já ignora a sessão): ao excluir a sessão, os
 * envios dela ainda na fila fecham na hora (SKIPPED/SESSION_DELETED), de oferta em envio ou pausada.
 * O que estiver saindo (SENDING) termina ou volta à fila e é fechado pelo lote do worker
 * (`skipForDeletedSessions`), que também finaliza a oferta. Ver docs/fila-de-envio.md §2.2.2.
 */
export class PrismaSessionOfferDispatchStore {
  constructor(private readonly prisma: PrismaClient) {}

  async pauseBySession(tenantId: string, sessionId: string): Promise<number> {
    const { count } = await this.prisma.offerDispatch.updateMany({
      where: { tenantId, sessionId, status: 'QUEUED' },
      data: { status: 'SKIPPED', failureReason: SESSION_DELETED_REASON },
    });
    return count;
  }
}
