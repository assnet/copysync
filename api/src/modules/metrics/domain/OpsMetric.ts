/**
 * Métricas de recursos da plataforma (MQ-21..25): dado de infraestrutura, sem tenant e sem PII.
 * Texto de SQL só como forma normalizada truncada (`meta.shape`), nunca bruto.
 */
export type OpsMetricSource = 'render' | 'postgres' | 'worker';

/** `gauge` agrega por média; `counter` (acumulado desde o reset) guarda o último valor. */
export type OpsMetricKind = 'gauge' | 'counter';

export type OpsMetricMeta = Record<string, string | number | null>;

/** Uma leitura de um tick (60 s). */
export interface OpsMetricReading {
  source: OpsMetricSource;
  /** `srv-…`/`dpg-…`, instância, workerId, nome do banco ou `queryid`. */
  resource: string;
  metric: string;
  value: number;
  kind: OpsMetricKind;
  meta?: OpsMetricMeta;
}

/** Linha persistida em `ops_metrics_samples`: agregado de uma janela de 5 min. */
export interface OpsMetricSample {
  at: Date;
  source: OpsMetricSource;
  resource: string;
  metric: string;
  value: number;
  meta: OpsMetricMeta | null;
}

/** Nomes estáveis das métricas (consumidos pela rota super admin e pelos alertas). */
export const OPS_METRIC = {
  cpu: 'cpu',
  cpuPct: 'cpu_pct',
  memory: 'memory',
  memoryPct: 'memory_pct',
  workerRssMb: 'rss_mb',
  nodeCpuPct: 'node_cpu_pct',
  eventLoopP99Ms: 'event_loop_p99_ms',
  dbConnections: 'db_connections',
  dbXactCommit: 'db_xact_commit',
  dbXactRollback: 'db_xact_rollback',
  dbDeadlocks: 'db_deadlocks',
  dbTempBytes: 'db_temp_bytes',
  dbCacheHitPct: 'db_cache_hit_pct',
  dbActive: 'db_active',
  dbIdle: 'db_idle',
  dbIdleInTransaction: 'db_idle_in_transaction',
  dbIdleInTransactionMaxAgeS: 'db_idle_in_transaction_max_age_s',
  dbStatementTotalMs: 'db_statement_total_ms',
} as const;
