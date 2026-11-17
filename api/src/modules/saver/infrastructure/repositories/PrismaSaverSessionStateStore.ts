import type { PrismaClient } from '@prisma/client';
import type { ISaverSessionStateStore } from '../../domain/contracts/ISaverSessionStateStore';

/**
 * Ritmo do Saver por sessão, no banco (sobrevive a reinício e adoção). `workerId` = processo dono do
 * socket: as sessões deste processo saem do lease no SQL (molde `PrismaLinkRotationMemberSyncStore`).
 */
export class PrismaSaverSessionStateStore implements ISaverSessionStateStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly workerId: string,
  ) {}

  async ownedSessionIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "sessions"
      WHERE "ownerWorkerId" = ${this.workerId} AND "leaseUntil" > (now() AT TIME ZONE 'UTC')
        AND "deletedAt" IS NULL`;
    return rows.map((r) => r.id);
  }

  /**
   * Sem linha de estado = devida (nunca leu). Só devolve sessão com item pendente pronto (QUEUED vencido
   * ou RUNNING com trava vencida): o tick de 2 s não acorda sessão sem trabalho.
   */
  async dueSessions(sessionIds: readonly string[], now: Date): Promise<string[]> {
    if (sessionIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s."id" FROM unnest(${[...sessionIds]}::text[]) AS s("id")
      LEFT JOIN "saver_session_states" st ON st."sessionId" = s."id"
      WHERE (st."sessionId" IS NULL OR (st."nextScanAt" <= ${now} AND (st."pausedUntil" IS NULL OR st."pausedUntil" <= ${now})))
        AND EXISTS (
          SELECT 1 FROM "saver_extraction_items" i
          WHERE i."sessionId" = s."id"
            AND ((i."status" = 'QUEUED' AND i."nextAttemptAt" <= ${now})
              OR (i."status" = 'RUNNING' AND (i."lockedUntil" IS NULL OR i."lockedUntil" <= ${now}))))
      ORDER BY s."id"`;
    return rows.map((r) => r.id);
  }

  async scheduleNext(sessionId: string, tenantId: string, nextScanAt: Date): Promise<void> {
    await this.prisma.saverSessionState.upsert({
      where: { sessionId },
      create: { sessionId, tenantId, nextScanAt },
      update: { nextScanAt },
    });
  }

  async pause(sessionId: string, tenantId: string, until: Date, reason: string): Promise<void> {
    await this.prisma.saverSessionState.upsert({
      where: { sessionId },
      create: { sessionId, tenantId, nextScanAt: until, pausedUntil: until, pauseReason: reason },
      update: { pausedUntil: until, pauseReason: reason },
    });
  }
}
