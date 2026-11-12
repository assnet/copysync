import { opsWorkerServiceId } from '../domain/services/opsMetricsSeriesPolicy';

/** IDs `srv-`/`dpg-` de `RENDER_RESOURCE_IDS` (vírgula). */
export function parseResourceIds(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Recursos que o sampler pede à Render: `RENDER_RESOURCE_IDS` + `WORKER_SCALER_SERVICE_ID` válido,
 * sem repetir. Assim o serviço worker (e as réplicas, que a Render devolve como `<id>-<sufixo>`)
 * entram sem mexer na lista. Id inválido é ignorado. Pura.
 */
export function samplerResourceIds(rawIds: string | undefined, rawWorkerServiceId: string | undefined): string[] {
  const ids = [...new Set(parseResourceIds(rawIds))];
  const worker = opsWorkerServiceId(rawWorkerServiceId);
  if (worker && !ids.includes(worker)) ids.push(worker);
  return ids;
}
