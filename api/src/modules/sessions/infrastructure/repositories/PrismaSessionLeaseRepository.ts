import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import type { ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';

/**
 * Lease de sessão em SQL cru (LEASE-03/04/05/09). Relógio do banco em UTC: as colunas são
 * `timestamp` sem fuso gravadas em UTC pelo Prisma, então `now()` vira UTC antes de comparar/gravar.
 * Operações só de lease não tocam `updatedAt` (a renovação roda a cada 20 s).
 */
const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
const until = (ttlMs: number) => Prisma.sql`${NOW} + (${Math.max(0, Math.trunc(ttlMs))}::int * interval '1 millisecond')`;

/** Status com socket aberto ou abrindo: no shutdown viram `DISCONNECTED`. */
const ACTIVE_STATUSES = ['CONNECTING', 'AWAITING_QR', 'AWAITING_PAIRING', 'AWAITING_CODE', 'AWAITING_PASSWORD', 'CONNECTED'];

export class PrismaSessionLeaseRepository implements ISessionLeaseRepository {
  async tryAcquire(sessionId: string, workerId: string, ttlMs: number): Promise<boolean> {
    const n = await prisma.$executeRaw`
      UPDATE "sessions" SET "ownerWorkerId" = ${workerId}, "leaseUntil" = ${until(ttlMs)}
      WHERE "id" = ${sessionId} AND "deletedAt" IS NULL
        AND ("leaseUntil" IS NULL OR "leaseUntil" < ${NOW} OR "ownerWorkerId" = ${workerId})`;
    return n > 0;
  }

  async renew(sessionIds: readonly string[], workerId: string, ttlMs: number): Promise<string[]> {
    if (sessionIds.length === 0) return [];
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE "sessions" SET "leaseUntil" = ${until(ttlMs)}
      WHERE "id" = ANY(${[...sessionIds]}::text[]) AND "ownerWorkerId" = ${workerId} AND "leaseUntil" > ${NOW}
      RETURNING "id"`;
    return rows.map((r) => r.id);
  }

  async release(sessionId: string, workerId: string): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "sessions" SET "ownerWorkerId" = NULL, "leaseUntil" = NULL
      WHERE "id" = ${sessionId} AND "ownerWorkerId" = ${workerId}`;
  }

  async releaseAllOwned(workerId: string): Promise<number> {
    return prisma.$executeRaw`
      UPDATE "sessions" SET "ownerWorkerId" = NULL, "leaseUntil" = NULL,
        "status" = CASE WHEN "status"::text = ANY(${ACTIVE_STATUSES}::text[]) THEN 'DISCONNECTED'::"SessionStatus" ELSE "status" END,
        "lastDisconnectedAt" = CASE WHEN "status"::text = ANY(${ACTIVE_STATUSES}::text[]) THEN ${NOW} ELSE "lastDisconnectedAt" END,
        "updatedAt" = ${NOW}
      WHERE "ownerWorkerId" = ${workerId}`;
  }
}
