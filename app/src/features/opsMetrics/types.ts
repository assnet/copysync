/** Métricas de recursos da plataforma (super admin). Contrato de `GET /admin/ops/metrics/{series,latest}`. */
export type OpsKind = 'api' | 'postgres' | 'worker' | 'query' | 'other';

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

export interface OpsLatest {
  latest: OpsLatestValue[];
  thresholds: OpsThresholds;
  topQueries: OpsTopQuery[];
  samplerActive: boolean;
  workers: OpsWorker[];
}

export type OpsRange = '1h' | '6h' | '24h' | '7d';
export type OpsResourceFilter = 'all' | 'api' | 'postgres';

/** Filtros da aba Consumo (persistidos por aba do navegador). */
export interface UsageFilters {
  range: OpsRange;
  resource: OpsResourceFilter;
  autoRefresh: boolean;
}

export type OpsStatus = 'ok' | 'warning' | 'critical' | 'noData';

/** Blocos buscados em paralelo; erro de um não derruba os outros. */
export type OpsBlock = 'latest' | 'servers' | 'database' | 'workers';
