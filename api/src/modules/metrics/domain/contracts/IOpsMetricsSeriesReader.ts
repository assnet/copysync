import type { OpsMetricSample, OpsMetricSource } from '../OpsMetric';

/** Filtro de `/series`: métricas já validadas, janela fechada `[from, to]`, recurso opcional. */
export interface OpsMetricsSeriesFilter {
  metrics: readonly string[];
  resource: string | null;
  from: Date;
  to: Date;
  bucketMinutes: number;
}

/** Um balde agregado no servidor; `at` = início do balde (UTC, alinhado à época). */
export interface OpsMetricBucketRow {
  source: OpsMetricSource;
  resource: string;
  metric: string;
  at: Date;
  avg: number;
  min: number;
  max: number;
}

/** Leitura agregada do dashboard super admin (`ops_metrics_samples`). Sem tenant. */
export interface IOpsMetricsSeriesReader {
  /** Baldes por (source, resource, metric), ordenados por série e `at` asc. */
  aggregate(filter: OpsMetricsSeriesFilter): Promise<OpsMetricBucketRow[]>;
  /** Última linha por (resource, metric) com `at >= since`, fora `db_statement_total_ms`. */
  latestSince(since: Date): Promise<OpsMetricSample[]>;
  /** Linhas do snapshot mais recente de `db_statement_total_ms` (top por tempo total). */
  latestStatementSnapshot(): Promise<OpsMetricSample[]>;
}
