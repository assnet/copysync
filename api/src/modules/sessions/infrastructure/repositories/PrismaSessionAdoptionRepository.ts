import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import type {
  AdoptedSessionRef,
  ISessionAdoptionRepository,
} from '../../domain/contracts/ISessionAdoptionRepository';
import { ADOPT_BACKOFF_CAP_MIN, MAX_ADOPT_ATTEMPTS } from '../../domain/services/sessionAdoptionPolicy';

/**
 * Adoção por capacidade em SQL cru (ADOPT-03/04/05). Mesmo relógio do lease: colunas `timestamp`
 * sem fuso gravadas em UTC, então `now()` vira UTC antes de comparar/gravar (independe do `TimeZone`
 * da conexão). Adoção e reset não tocam `updatedAt` (escrita operacional, não do usuário).
 */
const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
const until = (ttlMs: number) => Prisma.sql`${NOW} + (${Math.max(0, Math.trunc(ttlMs))}::int * interval '1 millisecond')`;

/**
 * Status adotáveis nas duas engines (sempre com lease nulo/vencido). `AWAITING_*`: o worker que abriu
 * o login morreu (SIGKILL/OOM) com o pedido vivo; sem lease vivo ninguém segura o socket, e a adoção
 * reconecta pelo caminho `auto` (gera QR/código novo como hoje).
 */
const ADOPTABLE_STATUSES = ['CONNECTED', 'CONNECTING', 'DISCONNECTED', 'AWAITING_QR', 'AWAITING_PAIRING'];

/**
 * Login por código/senha (2FA): só o Baileys reabre sozinho. No Telegram esses estados esperam o
 * usuário digitar o código/senha; sem pedido dele a sessão não é adotada, contada nem esgotada.
 */
const BAILEYS_ONLY_STATUSES = ['AWAITING_CODE', 'AWAITING_PASSWORD'];

const ADOPTABLE = (alias: string) => {
  const a = Prisma.raw(alias);
  return Prisma.sql`(${a}."status"::text = ANY(${ADOPTABLE_STATUSES}::text[])
    OR (${a}."status"::text = ANY(${BAILEYS_ONLY_STATUSES}::text[]) AND ${a}."engine" = 'baileys'))`;
};

const NOT_USER_LOGIN = (alias: string) => {
  const a = Prisma.raw(alias);
  return Prisma.sql`NOT (${a}."status"::text = ANY(${BAILEYS_ONLY_STATUSES}::text[]) AND ${a}."engine" <> 'baileys')`;
};

const LEASE_FREE = (alias: string) =>
  Prisma.sql`(${Prisma.raw(alias)}."leaseUntil" IS NULL OR ${Prisma.raw(alias)}."leaseUntil" < ${NOW})`;

export class PrismaSessionAdoptionRepository implements ISessionAdoptionRepository {
  async adoptNext(workerId: string, shard: string | null, ttlMs: number): Promise<AdoptedSessionRef | null> {
    // `FOR UPDATE OF s2`: trava só a sessão; travar o tenant faria o SKIP LOCKED pular o tenant inteiro.
    const rows = await prisma.$queryRaw<AdoptedSessionRef[]>`
      UPDATE "sessions" s SET "ownerWorkerId" = ${workerId}, "leaseUntil" = ${until(ttlMs)},
        "adoptFailures" = s."adoptFailures" + 1,
        "nextAdoptAt" = ${NOW} + (LEAST(power(2, s."adoptFailures" + 1), ${ADOPT_BACKOFF_CAP_MIN}::int) * interval '1 minute')
      WHERE s."id" = (
        SELECT s2."id" FROM "sessions" s2
        JOIN "tenants" t ON t."id" = s2."tenantId" AND t."status" = 'ACTIVE'
        WHERE s2."deletedAt" IS NULL AND s2."connectRequestedAt" IS NOT NULL
          AND ${ADOPTABLE('s2')}
          AND ${LEASE_FREE('s2')}
          AND (s2."nextAdoptAt" IS NULL OR s2."nextAdoptAt" < ${NOW})
          AND s2."adoptFailures" < ${MAX_ADOPT_ATTEMPTS}::int
          AND s2."shard" IS NOT DISTINCT FROM ${shard}::text
        ORDER BY s2."connectRequestedAt", s2."id"
        LIMIT 1 FOR UPDATE OF s2 SKIP LOCKED)
      RETURNING s."id", s."tenantId"`;
    return rows[0] ?? null;
  }

  async revertAdoptAttempt(sessionId: string, workerId: string): Promise<void> {
    // `nextAdoptAt` era nulo ou passado (condição de `adoptNext`): nulo equivale ao anterior.
    await prisma.$executeRaw`
      UPDATE "sessions" SET "ownerWorkerId" = NULL, "leaseUntil" = NULL,
        "adoptFailures" = GREATEST("adoptFailures" - 1, 0), "nextAdoptAt" = NULL
      WHERE "id" = ${sessionId} AND "ownerWorkerId" = ${workerId}`;
  }

  async failExhausted(): Promise<AdoptedSessionRef[]> {
    return prisma.$queryRaw<AdoptedSessionRef[]>`
      UPDATE "sessions" s SET "status" = 'FAILED'::"SessionStatus", "connectRequestedAt" = NULL, "updatedAt" = ${NOW}
      WHERE s."adoptFailures" >= ${MAX_ADOPT_ATTEMPTS}::int AND s."connectRequestedAt" IS NOT NULL
        AND s."deletedAt" IS NULL AND ${LEASE_FREE('s')} AND ${NOT_USER_LOGIN('s')}
      RETURNING s."id", s."tenantId"`;
  }

  async resetFailures(sessionId: string): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "sessions" SET "adoptFailures" = 0, "nextAdoptAt" = NULL
      WHERE "id" = ${sessionId} AND ("adoptFailures" > 0 OR "nextAdoptAt" IS NOT NULL)`;
  }

  async countAwaitingCapacity(olderThanMs?: number): Promise<number> {
    const older =
      olderThanMs === undefined
        ? Prisma.empty
        : Prisma.sql`AND s."connectRequestedAt" < ${NOW} - (${Math.max(0, Math.trunc(olderThanMs))}::int * interval '1 millisecond')`;
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "sessions" s
      JOIN "tenants" t ON t."id" = s."tenantId" AND t."status" = 'ACTIVE'
      WHERE s."deletedAt" IS NULL AND s."connectRequestedAt" IS NOT NULL
        AND ${ADOPTABLE('s')}
        AND ${LEASE_FREE('s')} ${older}`;
    return rows[0]?.n ?? 0;
  }
}
