import type { OpsMetricSample, OpsMetricSource } from '../OpsMetric';

/** Filtro de `/series`: métricas já validadas, janela fechada `[from, to]`, recurso opcional. */
export interface OpsMetricsSeriesFilter {
  metrics: readonly string[];
  resource: string | null;
  from: Date;
  to: Date;
  bucketMinutes: number;
  /** Teto de séries devolvidas (ordem: resource, metric, source); o resto não é lido. */
  maxSeries: number;
  /** Teto de `queryid` de `db_statement_total_ms` (top por `max(value)` na janela). */
  maxStatementSeries: number;
}

/** Um balde agregado no servidor; `at` = início do balde (UTC, alinhado à época). */
export interface OpsMetricBucketRow {
  source: OpsMetricSource;
  resource: string;
  metric: string;
  at: Date;
  avg: number;
  /** Gauge: menor `meta.min` (pico do tick); counter: menor `value`. */
  min: number;
  /** Gauge: maior `meta.max` (pico do tick); counter: maior `value`. */
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
