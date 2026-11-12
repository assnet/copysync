/** Métricas de recursos da plataforma (super admin). Contrato de `GET /admin/ops/metrics/{series,latest}`. */
/** `worker` = batimento por processo; `worker_service` = CPU/RAM da Render do serviço worker (todas as instâncias). */
export type OpsKind = 'api' | 'worker_service' | 'postgres' | 'worker' | 'query' | 'other';

export interface OpsSeriesPoint {
  /** Início do balde (ISO). */
  at: string;
  avg: number;
  min: number;
  max: number;
}

export interface OpsSeries {
  resource: string;
  kind: OpsKind;
  metric: string;
  points: OpsSeriesPoint[];
}

export interface OpsSeriesResult {
  window: { from: string; to: string };
  bucketMinutes: number;
  series: OpsSeries[];
}

export interface OpsLatestValue {
  resource: string;
  kind: OpsKind;
  metric: string;
  value: number;
  at: string;
}

export interface OpsThresholds {
  memoryPct: number;
  cpuPct: number;
  idleInTransaction: number;
  eventLoopP99Ms: number;
}

export interface OpsTopQuery {
  queryid: string;
  shape: string | null;
  totalMs: number;
  meanMs: number | null;
  calls: number | null;
  at: string;
}

export interface OpsWorker {
  workerId: string;
  role: string;
  sessions: number;
  pendingLogins: number;
  maxSessions: number;
  rssMb: number;
  cpuPct: number | null;
  eventLoopP99Ms: number | null;
  seenAt: string;
}

/** Batimento da instância (processo mais recente dela). */
export interface OpsWorkerInstanceHeartbeat {
  workerId: string;
  sessions: number;
  pendingLogins: number;
  maxSessions: number;
  rssMb: number;
  seenAt: string;
}

/**
 * Instância viva do serviço worker: CPU/RAM da Render casadas com o batimento pelo sufixo da
 * instância. `resource` nulo = batimento sem amostra; `heartbeat` nulo = amostra sem batimento.
 */
export interface OpsWorkerInstance {
  instance: string;
  resource: string | null;
  cpuPct: number | null;
  memoryPct: number | null;
  sampledAt: string | null;
  heartbeat: OpsWorkerInstanceHeartbeat | null;
}

export interface OpsLatest {
  latest: OpsLatestValue[];
  thresholds: OpsThresholds;
  topQueries: OpsTopQuery[];
  samplerActive: boolean;
  workers: OpsWorker[];
  /** Vazio sem worker separado (sem `WORKER_SCALER_SERVICE_ID` na API). */
  workerInstances: OpsWorkerInstance[];
}

export type OpsRange = '1h' | '6h' | '24h' | '7d';
/** Recursos com CPU e RAM da Render: o filtro usa o mesmo nome do `kind`. */
export type OpsServerKind = 'api' | 'worker_service' | 'postgres';
export type OpsResourceFilter = 'all' | OpsServerKind;

/** Filtros da aba Consumo (persistidos por aba do navegador). */
export interface UsageFilters {
  range: OpsRange;
  resource: OpsResourceFilter;
  autoRefresh: boolean;
}

/** Gráficos de Servidores: Worker como pior instância (1 linha) ou uma linha por instância. */
export type WorkerChartView = 'worst' | 'instance';

export type OpsStatus = 'ok' | 'warning' | 'critical' | 'noData';

/** Blocos buscados em paralelo; erro de um não derruba os outros. */
export type OpsBlock = 'latest' | 'servers' | 'database' | 'workers';
