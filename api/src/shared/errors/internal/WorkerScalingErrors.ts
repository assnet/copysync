import { AppError } from '../AppError';

// ── Configuração de escala dos workers (docs: .specs/features/worker-scaling) ─────

/** Configuração fora da faixa, de tipo errado ou com campo desconhecido (WSCALE-01). */
export class InvalidWorkerScalingSettingsError extends AppError {
  constructor(public readonly field: string, reason: string) {
    super('INVALID_WORKER_SCALING_SETTINGS', `Invalid worker scaling setting "${field}": ${reason}`, 400, { field });
  }
}

/** Outro admin salvou depois do `expectedUpdatedAt` informado (WSCALE-06). */
export class WorkerScalingSettingsConflictError extends AppError {
  constructor() {
    super('WORKER_SCALING_SETTINGS_CONFLICT', 'Worker scaling settings were changed by someone else', 409);
  }
}

// ── Escalador de workers (WSCALE-11) ─────────────────────────────────────────
// Nenhum erro carrega chave, id do serviço nem corpo da resposta do provedor.

/** Falta `WORKER_SCALER_ENABLED`, `RENDER_API_KEY` ou `WORKER_SCALER_SERVICE_ID`: nada foi chamado. */
export class ScalerNotConfiguredError extends AppError {
  constructor(missing: readonly string[]) {
    super('SCALER_NOT_CONFIGURED', 'Worker scaler is not configured', 409, { missing: [...missing] });
  }
}

/** Provedor recusou a credencial, não achou o serviço, falhou (5xx) ou estourou o timeout. */
export class ScalerUnavailableError extends AppError {
  constructor(public readonly reason: 'auth' | 'not_found' | 'upstream' | 'timeout') {
    super('SCALER_UNAVAILABLE', `Worker scaler provider unavailable (${reason})`, 503, { reason });
  }
}

/** Provedor respondeu 429. `retryAfterSeconds` vem do `Retry-After` (null se ausente ou inválido). */
export class ScalerRateLimitedError extends AppError {
  constructor(public readonly retryAfterSeconds: number | null) {
    super('SCALER_RATE_LIMITED', 'Worker scaler provider rate limited the request', 429, { retryAfterSeconds });
  }
}

/** Serviço com disco ou com autoescala nativa ligada: escalar por aqui é recusado. */
export class ScalerServiceNotScalableError extends AppError {
  constructor(public readonly reason: 'disk' | 'native_autoscaling') {
    super('SCALER_SERVICE_NOT_SCALABLE', `Worker service cannot be scaled (${reason})`, 409, { reason });
  }
}
