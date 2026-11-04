import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/database/prisma.client';
import type {
  IWorkerHeartbeatRepository,
  WorkerHeartbeat,
  WorkerHeartbeatInput,
} from '../../domain/contracts/IWorkerHeartbeatRepository';

/**
 * Heartbeat em `worker_heartbeats` (ADOPT-10/12) em SQL cru: relógio do banco em UTC, como o lease
 * de sessão (`timestamp` sem fuso gravado em UTC pelo Prisma).
 */
const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
/** Linha sem batimento há mais que isto é de processo morto e sai na limpeza do `beat`. */
const STALE_INTERVAL = Prisma.sql`interval '1 day'`;
/** Limite por limpeza: 1 `DELETE` pequeno por batimento, a tabela não cresce. */
const CLEANUP_LIMIT = 100;

type HeartbeatRow = WorkerHeartbeat;

const toHeartbeat = (r: HeartbeatRow): WorkerHeartbeat => ({
  workerId: r.workerId,
  role: r.role,
  sessions: r.sessions,
  maxSessions: r.maxSessions,
  rssMb: r.rssMb,
  seenAt: r.seenAt,
});

const int = (n: number) => Math.max(0, Math.trunc(n));

export class PrismaWorkerHeartbeatRepository implements IWorkerHeartbeatRepository {
  async beat(row: WorkerHeartbeatInput): Promise<void> {
    await prisma.$executeRaw`
      INSERT INTO "worker_heartbeats" ("workerId", "role", "sessions", "maxSessions", "rssMb", "seenAt")
      VALUES (${row.workerId}, ${row.role}, ${int(row.sessions)}, ${int(row.maxSessions)}, ${int(row.rssMb)}, ${NOW})
      ON CONFLICT ("workerId") DO UPDATE SET "role" = EXCLUDED."role", "sessions" = EXCLUDED."sessions",
        "maxSessions" = EXCLUDED."maxSessions", "rssMb" = EXCLUDED."rssMb", "seenAt" = EXCLUDED."seenAt"`;
    try {
      await prisma.$executeRaw`
        DELETE FROM "worker_heartbeats" WHERE "workerId" IN (
          SELECT "workerId" FROM "worker_heartbeats" WHERE "seenAt" < ${NOW} - ${STALE_INTERVAL} LIMIT ${CLEANUP_LIMIT}
        )`;
    } catch {
      // best-effort: o batimento já foi gravado; a próxima chamada tenta de novo
    }
  }

  async listAlive(maxAgeMs: number): Promise<WorkerHeartbeat[]> {
    const rows = await prisma.$queryRaw<HeartbeatRow[]>`
      SELECT "workerId", "role", "sessions", "maxSessions", "rssMb", "seenAt" FROM "worker_heartbeats"
      WHERE "seenAt" > ${NOW} - (${int(maxAgeMs)}::int * interval '1 millisecond')
      ORDER BY "workerId"`;
    return rows.map(toHeartbeat);
  }

  async remove(workerId: string): Promise<void> {
    await prisma.$executeRaw`DELETE FROM "worker_heartbeats" WHERE "workerId" = ${workerId}`;
  }
}
