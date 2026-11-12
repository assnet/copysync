import { AppError } from '../AppError';

// ── Custos da infraestrutura (docs: .specs/features/infra-costs) ─────────────

/** Configuração fora da faixa, de tipo errado, com campo desconhecido ou `key` repetida (COST-01). */
export class InvalidInfraCostSettingsError extends AppError {
  constructor(public readonly field: string, reason: string) {
    super('INVALID_INFRA_COST_SETTINGS', `Invalid infra cost setting "${field}": ${reason}`, 400, { field });
  }
}

/** Outro admin salvou depois do `expectedUpdatedAt` informado (COST-03). */
export class InfraCostSettingsConflictError extends AppError {
  constructor() {
    super('INFRA_COST_SETTINGS_CONFLICT', 'Infra cost settings were changed by someone else', 409);
  }
}

/** Mês pedido sem dado: na P1 só o mês corrente (UTC) tem resumo. */
export class InfraCostMonthUnavailableError extends AppError {
  constructor(month: string) {
    super('INFRA_COST_MONTH_UNAVAILABLE', `Infra cost summary is not available for month ${month}`, 400, { field: 'month' });
  }
}
