import type { PrismaClient } from '@prisma/client';
import type { IHubOutboxRepository, OutboxHeadEvent } from '../../domain/contracts/IHubOutboxRepository';

export class PrismaHubOutboxRepository implements IHubOutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async claimHeads(lockedUntil: Date): Promise<OutboxHeadEvent[]> {
    const now = new Date();

    const rows = await this.prisma.$queryRaw<OutboxHeadEvent[]>`
      WITH blocked_clients AS (
        SELECT DISTINCT "clientKey"
        FROM hub_outbox_events
        WHERE status = 'DEAD'
      ),
      heads AS (
        SELECT DISTINCT ON ("clientKey") *
        FROM hub_outbox_events
        WHERE status = 'PENDING'
          AND "clientKey" NOT IN (SELECT "clientKey" FROM blocked_clients)
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
          AND ("lockedUntil" IS NULL OR "lockedUntil" <= ${now})
        ORDER BY "clientKey", seq ASC
        FOR UPDATE SKIP LOCKED
      )
      UPDATE hub_outbox_events e
      SET "lockedUntil" = ${lockedUntil}
      FROM heads h
      WHERE e.id = h.id
      RETURNING e.id, e."clientKey", e.seq, e."installationId", e.type, e.payload, e.attempts, e."nextAttemptAt"
    `;

    return rows;
  }

  async markSent(id: string): Promise<void> {
    await this.prisma.hubOutboxEvent.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date(), lockedUntil: null },
    });
  }

  async markDead(id: string): Promise<void> {
    await this.prisma.hubOutboxEvent.update({
      where: { id },
      data: { status: 'DEAD', lockedUntil: null },
    });
  }

  async scheduleRetry(id: string, nextAttemptAt: Date): Promise<void> {
    await this.prisma.hubOutboxEvent.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        nextAttemptAt,
        lockedUntil: null,
      },
    });
  }

  async releaseLock(id: string): Promise<void> {
    await this.prisma.hubOutboxEvent.update({
      where: { id },
      data: { lockedUntil: null },
    });
  }

  async purgeSent(before: Date): Promise<number> {
    const result = await this.prisma.hubOutboxEvent.deleteMany({
      where: { status: 'SENT', createdAt: { lt: before } },
    });
    return result.count;
  }

  async purgeDead(before: Date): Promise<number> {
    const result = await this.prisma.hubOutboxEvent.deleteMany({
      where: { status: 'DEAD', createdAt: { lt: before } },
    });
    return result.count;
  }
}
