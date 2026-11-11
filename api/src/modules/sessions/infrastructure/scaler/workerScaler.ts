import { env } from '../../../../shared/config/env';
import { logger } from '../../../../shared/logger/logger';
import type { IWorkerScaler, WorkerScalerConfigKey } from '../../domain/contracts/IWorkerScaler';
import { NotConfiguredWorkerScaler } from './NotConfiguredWorkerScaler';
import { RenderWorkerScaler, type RenderWorkerScalerOptions } from './RenderWorkerScaler';

export interface WorkerScalerConfig {
  enabled: boolean;
  apiKey?: string;
  serviceId?: string;
}

/** Formato do id de serviço da Render. Fora dele o id conta como ausente. */
export const RENDER_SERVICE_ID_PATTERN = /^srv-[a-z0-9]+$/;

const isValidServiceId = (id: string | undefined): id is string => !!id && RENDER_SERVICE_ID_PATTERN.test(id);

/** Nomes das envs ausentes, na ordem fixa da doc (nunca valores). Id fora do formato = ausente. */
export function missingScalerConfig(config: WorkerScalerConfig): WorkerScalerConfigKey[] {
  const missing: WorkerScalerConfigKey[] = [];
  if (!config.enabled) missing.push('WORKER_SCALER_ENABLED');
  if (!config.apiKey) missing.push('RENDER_API_KEY');
  if (!isValidServiceId(config.serviceId)) missing.push('WORKER_SCALER_SERVICE_ID');
  return missing;
}

let warnedInvalidServiceId = false;

/** Só para testes: rearma o aviso único de id inválido. */
export function resetWorkerScalerWarningsForTests(): void {
  warnedInvalidServiceId = false;
}

/** Render só com as três envs; senão `NotConfiguredWorkerScaler` (nenhuma chamada sai). */
export function createWorkerScaler(
  config: WorkerScalerConfig,
  options: Pick<RenderWorkerScalerOptions, 'baseUrl' | 'timeoutMs' | 'fetchFn'> = {},
): IWorkerScaler {
  const missing = missingScalerConfig(config);
  if (config.serviceId && !isValidServiceId(config.serviceId) && !warnedInvalidServiceId) {
    warnedInvalidServiceId = true;
    // Nunca o valor: só o nome da env e o formato esperado
    logger.warn({ module: 'workerScaler', env: 'WORKER_SCALER_SERVICE_ID' }, 'worker scaler service id has invalid format (expected srv-...); scaler not configured');
  }
  if (missing.length > 0 || !config.apiKey || !isValidServiceId(config.serviceId)) return new NotConfiguredWorkerScaler(missing);
  return new RenderWorkerScaler({ ...options, apiKey: config.apiKey, serviceId: config.serviceId });
}

let instance: IWorkerScaler | undefined;

/** Escalador do processo (singleton), igual nos papéis `http` (rotas) e `worker` (job). */
export function workerScaler(): IWorkerScaler {
  instance ??= createWorkerScaler({
    enabled: env.WORKER_SCALER_ENABLED,
    apiKey: env.RENDER_API_KEY,
    serviceId: env.WORKER_SCALER_SERVICE_ID,
  });
  return instance;
}
