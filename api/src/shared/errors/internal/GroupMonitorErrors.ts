import { AppError } from '../AppError';

// ── Monitoramento de grupos (docs/monitoramento-grupos.md) ───────────────────

/** Campo fora da faixa ou combinação inválida. `field` = nome do campo no body. */
export class GroupMonitorInvalidInputError extends AppError {
  constructor(reason: string, field?: string) {
    super('GROUP_MONITOR_INVALID_INPUT', reason, 422, field ? { field } : undefined);
  }
}

/**
 * O mesmo grupo não pode ser monitorado e receber disparos no tenant: a oferta postada voltaria
 * como captura (laço).
 */
export class GroupMonitorGroupConflictError extends AppError {
  constructor(groupJid: string, role: 'monitored' | 'broadcast') {
    super('GROUP_MONITOR_GROUP_CONFLICT', `Group already used as ${role}: ${groupJid}`, 409, { groupJid, role });
  }
}

export class CapturedOfferNotFoundError extends AppError {
  constructor(id: string) {
    super('CAPTURED_OFFER_NOT_FOUND', `Captured offer not found: ${id}`, 404);
  }
}

/** Só SKIPPED/FAILED com motivo recuperável voltam para a fila de captura. */
export class CapturedOfferNotRetryableError extends AppError {
  constructor(id: string) {
    super('CAPTURED_OFFER_NOT_RETRYABLE', `Captured offer cannot be retried: ${id}`, 409);
  }
}
