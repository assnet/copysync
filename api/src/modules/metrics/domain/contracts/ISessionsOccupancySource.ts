import type { OpsMetricReading } from '../OpsMetric';

/**
 * Ocupação de sessões do cluster (WSCALE-08): `sessions_connected`, `sessions_pending_login`,
 * `sessions_awaiting` e `sessions_capacity` (fonte `sessions`, recurso `cluster`). Só contagens,
 * sem tenant; leitura no banco, sem chamada externa.
 */
export interface ISessionsOccupancySource {
  read(): Promise<OpsMetricReading[]>;
}
