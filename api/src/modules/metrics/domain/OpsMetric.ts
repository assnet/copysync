/**
 * Métricas de recursos da plataforma (MQ-21..25): dado de infraestrutura, sem tenant e sem PII.
 * Texto de SQL só como forma normalizada truncada (`meta.shape`), nunca bruto.
 */
export type OpsMetricSource = 'render' | 'postgres' | 'worker' | 'sessions';

/** `gauge` agrega por média; `counter` (acumulado desde o reset) guarda o último valor. */
export type OpsMetricKind = 'gauge' | 'counter';

export type OpsMetricMeta = Record<string, string | number | null>;

/** Uma leitura de um tick (60 s). */
export interface OpsMetricReading {
  source: OpsMetricSource;
  /** `srv-…`/`dpg-…`, instância, workerId, nome do banco, `queryid` ou `cluster` (sessões). */
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
  /** Fonte `sessions`, recurso `cluster` (WSCALE-08): contagens do banco a cada tick. */
  sessionsConnected: 'sessions_connected',
  sessionsPendingLogin: 'sessions_pending_login',
  sessionsAwaiting: 'sessions_awaiting',
  sessionsCapacity: 'sessions_capacity',
} as const;

/**
 * Métricas `counter` (acumulado desde o reset): o agregado guarda o último valor, sem `meta.min`/`max`.
 * No `/series` o min/max delas vem de `value`; as demais (gauge) usam `meta.min`/`meta.max` (pico do tick).
 */
export const OPS_COUNTER_METRICS: readonly string[] = [
  OPS_METRIC.dbXactCommit,
  OPS_METRIC.dbXactRollback,
  OPS_METRIC.dbDeadlocks,
  OPS_METRIC.dbTempBytes,
  OPS_METRIC.dbStatementTotalMs,
];
