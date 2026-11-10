import type { PrismaClient } from '@prisma/client';
import type { IDatabaseStatsSource } from '../../domain/contracts/IDatabaseStatsSource';
import { OPS_METRIC, type OpsMetricReading } from '../../domain/OpsMetric';
import { logger } from '../../../../shared/logger/logger';

/** Teto de cada consulta de catálogo (MQ-22). */
export const DB_STATS_STATEMENT_TIMEOUT = '2s';
/** Forma normalizada do `pg_stat_statements` truncada: sem SQL bruto (MQ-23). */
export const STATEMENT_SHAPE_MAX = 120;
const TOP_STATEMENTS = 10;

/** 1º comando de toda transação daqui; só vale dentro de `$transaction` (fora, autocommit e some). */
export const statementTimeout = (prisma: PrismaClient) =>
  prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${DB_STATS_STATEMENT_TIMEOUT}'`);

interface DatabaseRow {
  db: string;
  numbackends: number;
  xact_commit: number;
  xact_rollback: number;
  blks_read: number;
  blks_hit: number;
  deadlocks: number;
  temp_bytes: number;
}
interface ActivityRow {
  state: string | null;
  n: number;
  max_age_s: number | null;
}
interface StatementRow {
  queryid: string;
  calls: number;
  total_ms: number;
  mean_ms: number;
  shape: string | null;
}

/**
 * Catálogo do Postgres em transação com `SET LOCAL statement_timeout` (fora de transação o
 * `SET LOCAL` é autocommit e some; padrão de `PrismaSessionLeaseRepository`). Contadores em
 * `float8` para não voltar `bigint`.
 */
export class PrismaDatabaseStatsSource implements IDatabaseStatsSource {
  private readonly log = logger.child({ module: 'PrismaDatabaseStatsSource' });

  constructor(private readonly prisma: PrismaClient) {}

  async read(): Promise<OpsMetricReading[]> {
    const p = this.prisma;
    const [, dbRows, activity, ext] = await p.$transaction([
      statementTimeout(p),
      p.$queryRaw<DatabaseRow[]>`
        SELECT datname AS db, numbackends::float8 AS numbackends, xact_commit::float8 AS xact_commit,
          xact_rollback::float8 AS xact_rollback, blks_read::float8 AS blks_read, blks_hit::float8 AS blks_hit,
          deadlocks::float8 AS deadlocks, temp_bytes::float8 AS temp_bytes
        FROM pg_stat_database WHERE datname = current_database()`,
      p.$queryRaw<ActivityRow[]>`
        SELECT state, count(*)::float8 AS n, max(extract(epoch FROM (now() - state_change)))::float8 AS max_age_s
        FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend'
        GROUP BY state`,
      p.$queryRaw<{ ok: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS ok`,
    ]);
    const row = dbRows[0];
    const db = row?.db ?? 'db';
    const out: OpsMetricReading[] = [];
    const push = (metric: string, value: number | null | undefined, kind: 'gauge' | 'counter', resource = db) => {
      if (value != null && Number.isFinite(value)) out.push({ source: 'postgres', resource, metric, value, kind });
    };
    if (row) {
      push(OPS_METRIC.dbConnections, row.numbackends, 'gauge');
      push(OPS_METRIC.dbXactCommit, row.xact_commit, 'counter');
      push(OPS_METRIC.dbXactRollback, row.xact_rollback, 'counter');
      push(OPS_METRIC.dbDeadlocks, row.deadlocks, 'counter');
      push(OPS_METRIC.dbTempBytes, row.temp_bytes, 'counter');
      const blocks = row.blks_hit + row.blks_read;
      if (blocks > 0) push(OPS_METRIC.dbCacheHitPct, Math.round((row.blks_hit / blocks) * 10_000) / 100, 'gauge');
    }
    const byState = (s: string) => activity.find((a) => a.state === s);
    push(OPS_METRIC.dbActive, byState('active')?.n ?? 0, 'gauge');
    push(OPS_METRIC.dbIdle, byState('idle')?.n ?? 0, 'gauge');
    const idleTx = byState('idle in transaction');
    push(OPS_METRIC.dbIdleInTransaction, idleTx?.n ?? 0, 'gauge');
    push(OPS_METRIC.dbIdleInTransactionMaxAgeS, idleTx?.max_age_s ?? 0, 'gauge');

    if (ext[0]?.ok) out.push(...(await this.readStatements()));
    return out;
  }

  /** Top 10 por tempo total. Sem extensão/permissão: `[]` sem erro (a amostra segue). */
  private async readStatements(): Promise<OpsMetricReading[]> {
    const p = this.prisma;
    try {
      const [, rows] = await p.$transaction([
        statementTimeout(p),
        p.$queryRaw<StatementRow[]>`
          SELECT queryid::text AS queryid, calls::float8 AS calls, total_exec_time::float8 AS total_ms,
            mean_exec_time::float8 AS mean_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), ${STATEMENT_SHAPE_MAX}::int) AS shape
          FROM pg_stat_statements
          WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND queryid IS NOT NULL
          ORDER BY total_exec_time DESC LIMIT ${TOP_STATEMENTS}::int`,
      ]);
      return rows.map((r) => ({
        source: 'postgres' as const,
        resource: r.queryid,
        metric: OPS_METRIC.dbStatementTotalMs,
        value: Math.round(r.total_ms * 1000) / 1000,
        kind: 'counter' as const,
        meta: {
          calls: r.calls,
          meanMs: Math.round(r.mean_ms * 1000) / 1000,
          shape: r.shape ? r.shape.slice(0, STATEMENT_SHAPE_MAX) : null,
        },
      }));
    } catch (err) {
      this.log.debug({ err: (err as Error)?.name }, 'pg_stat_statements unavailable');
      return [];
    }
  }
}
