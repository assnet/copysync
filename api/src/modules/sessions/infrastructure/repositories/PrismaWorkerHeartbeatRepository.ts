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
  pendingLogins: r.pendingLogins,
  maxSessions: r.maxSessions,
  rssMb: r.rssMb,
  cpuPct: r.cpuPct ?? null,
  eventLoopP99Ms: r.eventLoopP99Ms ?? null,
  seenAt: r.seenAt,
});

const int = (n: number) => Math.max(0, Math.trunc(n));
/** Medida opcional: `null` se ausente/inválida, senão ≥ 0 com 1 casa. */
const metric = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? null : Math.max(0, Math.round(n * 10) / 10);

export class PrismaWorkerHeartbeatRepository implements IWorkerHeartbeatRepository {
  async beat(row: WorkerHeartbeatInput): Promise<void> {
    await prisma.$executeRaw`
      INSERT INTO "worker_heartbeats" ("workerId", "role", "sessions", "pendingLogins", "maxSessions", "rssMb", "cpuPct", "eventLoopP99Ms", "seenAt")
      VALUES (${row.workerId}, ${row.role}, ${int(row.sessions)}, ${int(row.pendingLogins)}, ${int(row.maxSessions)}, ${int(row.rssMb)},
        ${metric(row.cpuPct)}::double precision, ${metric(row.eventLoopP99Ms)}::double precision, ${NOW})
      ON CONFLICT ("workerId") DO UPDATE SET "role" = EXCLUDED."role", "sessions" = EXCLUDED."sessions",
        "pendingLogins" = EXCLUDED."pendingLogins", "maxSessions" = EXCLUDED."maxSessions", "rssMb" = EXCLUDED."rssMb",
        "cpuPct" = EXCLUDED."cpuPct", "eventLoopP99Ms" = EXCLUDED."eventLoopP99Ms", "seenAt" = EXCLUDED."seenAt"`;
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
      SELECT "workerId", "role", "sessions", "pendingLogins", "maxSessions", "rssMb", "cpuPct", "eventLoopP99Ms", "seenAt" FROM "worker_heartbeats"
      WHERE "seenAt" > ${NOW} - (${int(maxAgeMs)}::int * interval '1 millisecond')
      ORDER BY "workerId"`;
    return rows.map(toHeartbeat);
  }

  async hasAlive(maxAgeMs: number): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ alive: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM "worker_heartbeats"
        WHERE "seenAt" > ${NOW} - (${int(maxAgeMs)}::int * interval '1 millisecond')) AS "alive"`;
    return rows[0]?.alive === true;
  }

  async remove(workerId: string): Promise<void> {
    await prisma.$executeRaw`DELETE FROM "worker_heartbeats" WHERE "workerId" = ${workerId}`;
  }
}
