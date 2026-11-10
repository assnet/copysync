import type { OpsMetricReading } from '../OpsMetric';

/**
 * CPU/RAM reais dos containers e do Postgres na plataforma de hospedagem (MQ-22). Só no job do
 * `worker`, nunca em requisição. Falha parcial devolve o que conseguiu; falha total lança.
 */
export interface IPlatformMetricsSource {
  /** `signal` cancela a leitura em voo (shutdown). */
  read(signal?: AbortSignal): Promise<OpsMetricReading[]>;
}
