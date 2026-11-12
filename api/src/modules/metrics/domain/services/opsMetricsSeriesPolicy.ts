import { OPS_METRIC, type OpsMetricSource } from '../OpsMetric';

/** Classe do recurso no dashboard (derivada, não gravada). */
/**
 * `worker` = batimento por processo (`source='worker'`); `worker_service` = amostra da Render do
 * serviço worker (`WORKER_SCALER_SERVICE_ID` e instâncias `<id>-<sufixo>`).
 */
export type OpsResourceKind = 'api' | 'worker_service' | 'postgres' | 'worker' | 'query' | 'other';

/** Degraus permitidos para o balde (minutos). */
export const OPS_BUCKET_STEPS_MIN = [1, 5, 15, 30, 60, 120, 360] as const;
/** Menor balde: a tabela já guarda agregados de 5 min. */
export const OPS_MIN_BUCKET_MIN = 5;
/** Alvo de pontos por série: a janela é dividida em no máximo ~240 baldes. */
export const OPS_SERIES_TARGET_POINTS = 240;
/** Teto de métricas por chamada de `/series`. */
export const OPS_SERIES_MAX_METRICS = 12;
/** Teto de séries (source, resource, metric) por resposta de `/series`, aplicado no SQL. */
export const OPS_SERIES_MAX_SERIES = 40;
/** `db_statement_total_ms` sem `resource`: só os N `queryid` de maior `max(value)` na janela. */
export const OPS_SERIES_MAX_STATEMENT_SERIES = 10;

const KNOWN = new Set<string>(Object.values(OPS_METRIC));

/** Nome da métrica pertence a `OPS_METRIC`. */
export const isOpsMetricName = (name: string): boolean => KNOWN.has(name);

/**
 * Tamanho do balde: `max(5 min, ceil(janela / 240))` arredondado para cima ao próximo degrau
 * (1/5/15/30/60/120/360). 7 dias → 60 min (168 pontos). Pura.
 */
export function opsBucketMinutes(windowMs: number): number {
  const raw = Math.max(OPS_MIN_BUCKET_MIN, Math.ceil(windowMs / 60_000 / OPS_SERIES_TARGET_POINTS));
  return OPS_BUCKET_STEPS_MIN.find((s) => s >= raw) ?? OPS_BUCKET_STEPS_MIN[OPS_BUCKET_STEPS_MIN.length - 1];
}

/** Formato do id de serviço da Render. */
export const OPS_RENDER_SERVICE_ID_PATTERN = /^srv-[a-z0-9]+$/;

/** Id do serviço worker já conferido (`srv-...`); fora do formato ou ausente = `null`. Pura. */
export function opsWorkerServiceId(raw: string | null | undefined): string | null {
  const id = raw?.trim();
  return id && OPS_RENDER_SERVICE_ID_PATTERN.test(id) ? id : null;
}

/**
 * `query` (top do `pg_stat_statements`) > `worker` (heartbeat) > `postgres` (`dpg-` ou catálogo) >
 * `worker_service` (`srv-` igual a `workerServiceId` ou `<workerServiceId>-<instância>`) >
 * `api` (outro `srv-`) > `other`. Sem `workerServiceId` todo `srv-` é `api`. Pura.
 */
export function opsResourceKind(
  source: OpsMetricSource | string,
  resource: string,
  metric: string,
  workerServiceId: string | null = null,
): OpsResourceKind {
  if (metric === OPS_METRIC.dbStatementTotalMs) return 'query';
  if (source === 'worker') return 'worker';
  if (source === 'postgres' || resource.startsWith('dpg-')) return 'postgres';
  if (resource.startsWith('srv-')) {
    if (workerServiceId && (resource === workerServiceId || resource.startsWith(`${workerServiceId}-`))) return 'worker_service';
    return 'api';
  }
  return 'other';
}
