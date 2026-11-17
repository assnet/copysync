import { AppError } from '../AppError';

// ── Uso dos recursos (docs: .specs/features/usage-metrics, design §6) ──────

/**
 * Período recusado pelo use case: `from > to`, data futura ou acima do teto da fonte (90 dias sem
 * agregado, 400 com). Formato inválido e granularidade param antes, no schema da rota.
 */
export class UsageMetricsRangeInvalidError extends AppError {
  constructor(reason: string, maxDays?: number) {
    super('USAGE_METRICS_RANGE_INVALID', `Invalid usage metrics range: ${reason}`, 400, {
      field: 'range',
      ...(maxDays !== undefined ? { maxDays } : {}),
    });
  }
}

/** Chave fora do catálogo de recursos medidos. */
export class UsageMetricsFeatureNotFoundError extends AppError {
  constructor() {
    super('USAGE_METRICS_FEATURE_NOT_FOUND', 'Usage metrics feature not found', 404, { field: 'featureKey' });
  }
}

/** Cursor adulterado, vencido, de outro recurso ou de outro recorte: o painel recomeça da 1ª página. */
export class UsageMetricsCursorInvalidError extends AppError {
  constructor() {
    super('USAGE_METRICS_CURSOR_INVALID', 'Usage metrics page cursor is invalid or expired, reload the list', 400, {
      field: 'cursor',
    });
  }
}

/**
 * Leitura indisponível agora: orçamento do pedido esgotado (inclusive esperando conexão),
 * `statement_timeout` (SQLSTATE 57014), outra leitura de uso em andamento no processo ou linhas acima
 * da guarda. 503, o painel mostra "tentar de novo". Sem SQL nem erro do banco (nem como `cause`).
 */
export class UsageMetricsReadUnavailableError extends AppError {
  constructor() {
    super('USAGE_METRICS_READ_UNAVAILABLE', 'Usage metrics data is temporarily unavailable, try again', 503);
  }
}
