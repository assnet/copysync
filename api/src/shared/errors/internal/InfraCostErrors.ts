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

/**
 * Leitura do resumo estourou o `statement_timeout` (SQLSTATE 57014): 503, o painel mostra "tentar de
 * novo". Sem SQL, sem id e sem o erro do banco (nem como `cause`): só este código chega ao log.
 */
export class InfraCostReadUnavailableError extends AppError {
  constructor() {
    super('INFRA_COST_READ_UNAVAILABLE', 'Infra cost data is temporarily unavailable, try again', 503);
  }
}

/**
 * Cursor da lista por cliente inválido, expirado ou de outro escopo (mês, plano, aberto × fechado): 400, o
 * painel recomeça da 1ª página. Nunca vira a página 1 em silêncio (a lista pularia ou repetiria clientes).
 */
export class InfraCostCursorInvalidError extends AppError {
  constructor() {
    super('INFRA_COST_CURSOR_INVALID', 'Infra cost page cursor is invalid or expired, reload the list', 400, { field: 'cursor' });
  }
}
