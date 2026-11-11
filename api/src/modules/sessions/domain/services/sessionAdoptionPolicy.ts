/**
 * Política da adoção por capacidade (ADOPT-02). Constantes fixas e funções puras,
 * sem env nem relógio. Ver `.specs/features/session-adoption/spec.md` e
 * `docs/arquitetura-escala.md` §3.2.
 */

/** Intervalo do ticker de adoção: uma sessão por tick (D2). */
export const ADOPT_TICK_MS = 5_000;

/** Tentativas de adoção sem `CONNECTED` antes de a sessão virar `FAILED`. */
export const MAX_ADOPT_ATTEMPTS = 5;

/** Teto do backoff entre tentativas de adoção, em minutos. */
export const ADOPT_BACKOFF_CAP_MIN = 30;

/** Intervalo do heartbeat do worker. */
export const HEARTBEAT_MS = 20_000;

/** Worker vivo = último heartbeat há menos que isto. */
export const WORKER_ALIVE_MS = 90_000;

/** Default do limiar de ocupação (fração da soma dos tetos); o valor efetivo vem da configuração de escala. */
export const CAPACITY_ALERT_RATIO = 0.8;

/** Default da espera máxima de pedido sem dono; o valor efetivo vem da configuração de escala. */
export const AWAITING_ALERT_MS = 120_000;

/** Intervalo do job de alerta de capacidade. */
export const ALERT_TICK_MS = 60_000;

/**
 * Minutos até a próxima adoção: `min(2^n, 30)`, com `n` = `adoptFailures` já
 * incrementado pela tentativa (D1). `n <= 0` vale 1 minuto.
 */
export function adoptBackoffMinutes(failures: number): number {
  const n = Number.isFinite(failures) ? Math.max(0, Math.floor(failures)) : 0;
  return Math.min(2 ** n, ADOPT_BACKOFF_CAP_MIN);
}

/** O processo ainda tem vaga para mais um socket. */
export function hasCapacity(active: number, max: number): boolean {
  return active < max;
}

export type CapacityAlertReason = 'occupancy' | 'awaiting';

export interface CapacityAlertInput {
  /** Soma das sessões ativas dos workers vivos. */
  sessions: number;
  /** Soma dos tetos dos workers vivos. */
  maxSessions: number;
  /** Idade do pedido sem dono mais antigo (ms); `null` sem pedido aguardando. */
  awaitingOverMs: number | null;
  /** Alerta quando a ocupação passa (estritamente) desta fração (`alertOccupancyRatio`). */
  ratio: number;
  /** Alerta quando o pedido sem dono passa (estritamente) destes segundos (`awaitingAlertSeconds`). */
  awaitingSeconds: number;
}

/**
 * Motivo do alerta de capacidade, ou `null`. Ocupação exatamente em `ratio` não alerta;
 * soma de tetos 0 (nenhum worker vivo) não alerta por ocupação, só por espera.
 */
export function capacityAlertReason(input: CapacityAlertInput): CapacityAlertReason | null {
  const { sessions, maxSessions, awaitingOverMs, ratio, awaitingSeconds } = input;
  if (maxSessions > 0 && sessions / maxSessions > ratio) return 'occupancy';
  if (awaitingOverMs !== null && awaitingOverMs > awaitingSeconds * 1000) return 'awaiting';
  return null;
}
