import type { OpsMetricSample } from '../OpsMetric';

/** Filtro da leitura super admin (MQ-25): janela fechada `[from, to]`, métrica opcional. */
export interface OpsMetricsSampleFilter {
  metric: string | null;
  from: Date;
  to: Date;
}

/** `ops_metrics_samples` (MQ-23): agregados de 5 min, retenção de 7 dias. Sem tenant. */
export interface IOpsMetricsSampleRepository {
  insertMany(samples: readonly OpsMetricSample[]): Promise<number>;
  /** Apaga linhas com `at < cutoff`; devolve quantas. */
  deleteOlderThan(cutoff: Date): Promise<number>;
  /** Linhas de `metric` com `at >= since`, mais novas primeiro. */
  listSince(metric: string, since: Date): Promise<OpsMetricSample[]>;
}

/** Leitura paginada da rota super admin (MQ-25), separada da escrita do sampler. */
export interface IOpsMetricsSampleReader {
  /** Página de `filter` ordenada por `at` desc (desempate por id desc); `limit` vem do servidor. */
  listPage(filter: OpsMetricsSampleFilter, offset: number, limit: number): Promise<OpsMetricSample[]>;
}
