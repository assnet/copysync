import type { PrismaClient } from '@prisma/client';
import type { IHubOutboxRepository, OutboxHeadEvent } from '../../domain/contracts/IHubOutboxRepository';

export class PrismaHubOutboxRepository implements IHubOutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async claimHeads(lockedUntil: Date): Promise<OutboxHeadEvent[]> {
    const now = new Date();

    const rows = await this.prisma.$queryRaw<OutboxHeadEvent[]>`
      -- Cabeça = menor seq PENDING do cliente (DISTINCT ON não pode ser usado com FOR UPDATE).
      -- Se a cabeça ainda espera retry ou está com lock, nenhum evento posterior do cliente
      -- passa à frente: a ordem por cliente é preservada.
      WITH heads AS (
        SELECT o.id
        FROM hub_outbox_events o
        WHERE o.status = 'PENDING'
          AND (o."nextAttemptAt" IS NULL OR o."nextAttemptAt" <= ${now})
          AND (o."lockedUntil" IS NULL OR o."lockedUntil" <= ${now})
          AND NOT EXISTS (
            SELECT 1 FROM hub_outbox_events d
            WHERE d."clientKey" = o."clientKey" AND d.status = 'DEAD'
          )
          AND NOT EXISTS (
            SELECT 1 FROM hub_outbox_events p
            WHERE p."clientKey" = o."clientKey" AND p.status = 'PENDING' AND p.seq < o.seq
          )
        FOR UPDATE OF o SKIP LOCKED
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
