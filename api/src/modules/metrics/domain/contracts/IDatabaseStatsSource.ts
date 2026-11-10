import type { OpsMetricReading } from '../OpsMetric';

/**
 * Estatísticas de catálogo do Postgres (MQ-22): `pg_stat_database`, `pg_stat_activity` agregado e
 * top 10 de `pg_stat_statements` (só `queryid` + forma normalizada truncada). Cada consulta com
 * `statement_timeout` curto; extensão ausente = sem as linhas de statements, sem erro.
 */
export interface IDatabaseStatsSource {
  read(): Promise<OpsMetricReading[]>;
}
