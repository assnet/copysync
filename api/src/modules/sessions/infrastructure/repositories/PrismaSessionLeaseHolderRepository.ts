import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import type { ISessionLeaseHolderRepository, SessionLeaseHolder } from '../../domain/contracts/ISessionLeaseHolderRepository';

/** Relógio do banco em UTC, como o lease (`timestamp` sem fuso gravado em UTC). */
const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

/** Leitura agregada de `sessions.ownerWorkerId/leaseUntil`. Plataforma: sem filtro de tenant (super-admin). */
export class PrismaSessionLeaseHolderRepository implements ISessionLeaseHolderRepository {
  async listLiveHolders(): Promise<SessionLeaseHolder[]> {
    const rows = await prisma.$queryRaw<SessionLeaseHolder[]>`
      SELECT "ownerWorkerId" AS "workerId", COUNT(*)::int AS "sessions", MAX("leaseUntil") AS "leaseUntil"
      FROM "sessions"
      WHERE "ownerWorkerId" IS NOT NULL AND "leaseUntil" > ${NOW} AND "deletedAt" IS NULL
      GROUP BY "ownerWorkerId" ORDER BY "ownerWorkerId"`;
    return rows.map((r) => ({ workerId: r.workerId, sessions: Number(r.sessions), leaseUntil: r.leaseUntil }));
  }
}
