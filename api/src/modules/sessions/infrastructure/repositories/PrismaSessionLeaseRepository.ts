import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import type { ISessionLeaseRepository } from '../../domain/contracts/ISessionLeaseRepository';
import { LEASE_RENEW_TIMEOUT_MS } from '../../domain/services/sessionLeasePolicy';

/**
 * Lease de sessão em SQL cru (LEASE-03/04/05/09). Relógio do banco em UTC: as colunas são
 * `timestamp` sem fuso gravadas em UTC pelo Prisma, então `now()` vira UTC antes de comparar/gravar.
 * Operações só de lease não tocam `updatedAt` (a renovação roda a cada 20 s).
 */
const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
const until = (ttlMs: number) => Prisma.sql`${NOW} + (${Math.max(0, Math.trunc(ttlMs))}::int * interval '1 millisecond')`;

/** Status com socket aberto ou abrindo: no shutdown viram `DISCONNECTED`. */
const ACTIVE_STATUSES = ['CONNECTING', 'AWAITING_QR', 'AWAITING_PAIRING', 'AWAITING_CODE', 'AWAITING_PASSWORD', 'CONNECTED'];

/** Prazo estourado numa operação do lease: transitório (quem chama trata como erro de banco). */
export class SessionLeaseDeadlineError extends Error {
  constructor(operation: string, ms: number) {
    super(`operação de lease ${operation} excedeu ${ms} ms`);
    this.name = 'SessionLeaseDeadlineError';
  }
}

/**
 * Prazo (F12): `tryAcquire`/`renew`/`release` sempre assentam em `deadlineMs`. Duas camadas:
 * `SET LOCAL statement_timeout` na transação (o Postgres cancela a espera por lock e devolve a
 * conexão ao pool) e `Promise.race` (banco mudo: nem o BEGIN responde). A query que perde a corrida
 * segue no driver e é descartada.
 */
export class PrismaSessionLeaseRepository implements ISessionLeaseRepository {
  constructor(private readonly deadlineMs: number = LEASE_RENEW_TIMEOUT_MS) {}

  private async withDeadline<T>(operation: string, query: Prisma.PrismaPromise<T>): Promise<T> {
    const ms = Math.max(1, Math.trunc(this.deadlineMs));
    const work = prisma
      .$transaction([prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = ${ms}`), query])
      .then(([, result]) => result);
    work.catch(() => undefined); // perdeu a corrida: rejeição tardia descartada
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SessionLeaseDeadlineError(operation, ms)), ms);
    });
    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async tryAcquire(sessionId: string, workerId: string, ttlMs: number): Promise<boolean> {
    const n = await this.withDeadline('tryAcquire', prisma.$executeRaw`
      UPDATE "sessions" SET "ownerWorkerId" = ${workerId}, "leaseUntil" = ${until(ttlMs)}
      WHERE "id" = ${sessionId} AND "deletedAt" IS NULL
        AND ("leaseUntil" IS NULL OR "leaseUntil" < ${NOW} OR "ownerWorkerId" = ${workerId})`);
    return n > 0;
  }

  /** Sessão apagada (em qualquer processo) não renova: o dono a trata como lease perdido. */
  async renew(sessionIds: readonly string[], workerId: string, ttlMs: number): Promise<string[]> {
    if (sessionIds.length === 0) return [];
    const rows = await this.withDeadline('renew', prisma.$queryRaw<{ id: string }[]>`
      UPDATE "sessions" SET "leaseUntil" = ${until(ttlMs)}
      WHERE "id" = ANY(${[...sessionIds]}::text[]) AND "ownerWorkerId" = ${workerId} AND "leaseUntil" > ${NOW}
        AND "deletedAt" IS NULL
      RETURNING "id"`);
    return rows.map((r) => r.id);
  }

  async release(sessionId: string, workerId: string): Promise<void> {
    await this.withDeadline('release', prisma.$executeRaw`
      UPDATE "sessions" SET "ownerWorkerId" = NULL, "leaseUntil" = NULL
      WHERE "id" = ${sessionId} AND "ownerWorkerId" = ${workerId}`);
  }

  async releaseAllOwned(workerId: string): Promise<number> {
    return prisma.$executeRaw`
      UPDATE "sessions" SET "ownerWorkerId" = NULL, "leaseUntil" = NULL,
        "status" = CASE WHEN "status"::text = ANY(${ACTIVE_STATUSES}::text[]) THEN 'DISCONNECTED'::"SessionStatus" ELSE "status" END,
        "lastDisconnectedAt" = CASE WHEN "status"::text = ANY(${ACTIVE_STATUSES}::text[]) THEN ${NOW} ELSE "lastDisconnectedAt" END,
        "updatedAt" = ${NOW}
      WHERE "ownerWorkerId" = ${workerId}`;
  }

  async findLiveOwner(sessionId: string): Promise<string | null> {
    const rows = await prisma.$queryRaw<{ ownerWorkerId: string }[]>`
      SELECT "ownerWorkerId" FROM "sessions"
      WHERE "id" = ${sessionId} AND "ownerWorkerId" IS NOT NULL AND "leaseUntil" > ${NOW}`;
    return rows[0]?.ownerWorkerId ?? null;
  }
}
