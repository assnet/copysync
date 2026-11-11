import { Prisma, type PrismaClient } from '@prisma/client';
import type { ISessionsOccupancySource } from '../../domain/contracts/ISessionsOccupancySource';
import { OPS_METRIC, type OpsMetricReading } from '../../domain/OpsMetric';
import { SESSIONS_CLUSTER_RESOURCE } from '../../domain/services/opsAlertPolicy';
import type { ISessionAdoptionRepository } from '../../../sessions/domain/contracts/ISessionAdoptionRepository';
import type { IWorkerHeartbeatRepository } from '../../../sessions/domain/contracts/IWorkerHeartbeatRepository';
import { WORKER_ALIVE_MS } from '../../../sessions/domain/services/sessionAdoptionPolicy';
import { statementTimeout } from './PrismaDatabaseStatsSource';

export const SESSIONS_RESOURCE = SESSIONS_CLUSTER_RESOURCE;

/** Relógio do lease: `timestamp` sem fuso gravado em UTC. */
const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
/** Login em andamento (não ocupa vaga): QR/código/senha sem leitura ou socket abrindo. */
const PENDING_LOGIN_STATUSES = ['CONNECTING', 'AWAITING_QR', 'AWAITING_PAIRING', 'AWAITING_CODE', 'AWAITING_PASSWORD'];

interface CountsRow {
  connected: number;
  pending: number;
  owners: number;
}

export interface SessionsOccupancySourceDeps {
  prisma: PrismaClient;
  /** `WORKER_ADOPTION_ENABLED`, lido a cada tick. */
  adoptionEnabled: () => boolean;
  /** Sessões sem dono vivo esperando capacidade (mesma regra do `GET /admin/workers`). */
  adoption: Pick<ISessionAdoptionRepository, 'countAwaitingCapacity'>;
  heartbeats: Pick<IWorkerHeartbeatRepository, 'listAlive'>;
  /** `maxSessionsPerWorker` da configuração de escala efetiva, lido a cada tick. */
  maxSessionsPerWorker: () => number;
}

/**
 * Contagens de `design.md` §4 a cada tick, em `all` e `worker`, com ou sem adoção. Conectadas,
 * em login e processos donos de lease saem de uma consulta com `statement_timeout` de 2 s.
 * Adoção desligada: `awaiting` = 0 sem consultar e `capacity` = teto × processos donos de lease
 * (mínimo 1). Ligada: `awaiting` = `countAwaitingCapacity()` e `capacity` = soma dos tetos dos
 * batimentos vivos. Só leitura.
 */
export class SessionsOccupancySource implements ISessionsOccupancySource {
  constructor(private readonly deps: SessionsOccupancySourceDeps) {}

  async read(): Promise<OpsMetricReading[]> {
    const { prisma: p, adoptionEnabled, adoption, heartbeats, maxSessionsPerWorker } = this.deps;
    const enabled = adoptionEnabled();
    const [[, rows], awaiting, alive] = await Promise.all([
      p.$transaction([
        statementTimeout(p),
        p.$queryRaw<CountsRow[]>`
          SELECT COUNT(*) FILTER (WHERE "status" = 'CONNECTED')::int AS connected,
            COUNT(*) FILTER (WHERE "status"::text = ANY(${PENDING_LOGIN_STATUSES}::text[]))::int AS pending,
            COUNT(DISTINCT "ownerWorkerId")::int AS owners
          FROM "sessions"
          WHERE "deletedAt" IS NULL AND "ownerWorkerId" IS NOT NULL AND "leaseUntil" > ${NOW}`,
      ]),
      enabled ? adoption.countAwaitingCapacity() : Promise.resolve(0),
      enabled ? heartbeats.listAlive(WORKER_ALIVE_MS) : Promise.resolve([]),
    ]);
    const counts = rows[0] ?? { connected: 0, pending: 0, owners: 0 };
    const capacity = enabled
      ? alive.reduce((sum, w) => sum + w.maxSessions, 0)
      : maxSessionsPerWorker() * Math.max(1, Number(counts.owners));
    const reading = (metric: string, value: number): OpsMetricReading =>
      ({ source: 'sessions', resource: SESSIONS_RESOURCE, metric, value: Number(value), kind: 'gauge' });
    return [
      reading(OPS_METRIC.sessionsConnected, counts.connected),
      reading(OPS_METRIC.sessionsPendingLogin, counts.pending),
      reading(OPS_METRIC.sessionsAwaiting, awaiting),
      reading(OPS_METRIC.sessionsCapacity, capacity),
    ];
  }
}
