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
