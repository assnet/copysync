/**
 * Agenda da busca automática da cotação (COST-06a, P2). Estado em `platform_settings["infra_fx_fetch_state"]`,
 * nunca em memória: sobrevive a reinício e à troca do processo dono do job. Puro, sem I/O.
 *
 * Regra: 1×/dia (UTC) a partir de 16h30 UTC (PTAX sai ~13h de Brasília); PTAX → SGS; as duas falhando,
 * mantém a última gravada e faz no máximo 1 nova tentativa 1 h depois. Tentativa conta antes da busca
 * (processo que cai no meio não ganha tentativa extra).
 */

/** Minutos do dia (UTC) a partir dos quais a busca do dia pode sair. */
export const INFRA_FX_FETCH_AFTER_UTC_MINUTES = 16 * 60 + 30;
export const INFRA_FX_FETCH_RETRY_DELAY_MS = 3_600_000;
/** 1ª tentativa + 1 nova tentativa. */
export const INFRA_FX_FETCH_MAX_ATTEMPTS = 2;

export interface InfraFxFetchState {
  /** Dia (UTC) `YYYY-MM-DD` das tentativas. */
  referenceDay: string;
  attempts: number;
  lastAttemptAt: Date;
  /** Alguma tentativa do dia gravou cotação. */
  ok: boolean;
}

export const utcDayOf = (d: Date): string => d.toISOString().slice(0, 10);

/** JSON gravado → estado; formato inválido = `null` (como se não houvesse tentativa). */
export function parseInfraFxFetchState(value: unknown): InfraFxFetchState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const at = typeof v.lastAttemptAt === 'string' ? new Date(v.lastAttemptAt) : null;
  if (
    typeof v.referenceDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.referenceDay)
    || typeof v.attempts !== 'number' || !Number.isInteger(v.attempts) || v.attempts < 0
    || !at || Number.isNaN(at.getTime()) || typeof v.ok !== 'boolean'
  ) return null;
  return { referenceDay: v.referenceDay, attempts: v.attempts, lastAttemptAt: at, ok: v.ok };
}

/** Estado → JSON de `platform_settings`. */
export function serializeInfraFxFetchState(s: InfraFxFetchState): Record<string, unknown> {
  return { referenceDay: s.referenceDay, attempts: s.attempts, lastAttemptAt: s.lastAttemptAt.toISOString(), ok: s.ok };
}

/** A busca deve sair agora? */
export function isFxFetchDue(state: InfraFxFetchState | null, now: Date): boolean {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (minutes < INFRA_FX_FETCH_AFTER_UTC_MINUTES) return false;
  if (!state || state.referenceDay !== utcDayOf(now)) return true;
  if (state.ok || state.attempts >= INFRA_FX_FETCH_MAX_ATTEMPTS) return false;
  return now.getTime() - state.lastAttemptAt.getTime() >= INFRA_FX_FETCH_RETRY_DELAY_MS;
}

/** Estado gravado antes da busca (conta a tentativa). */
export function startFxFetchAttempt(state: InfraFxFetchState | null, now: Date): InfraFxFetchState {
  const today = utcDayOf(now);
  const attempts = state && state.referenceDay === today ? state.attempts + 1 : 1;
  return { referenceDay: today, attempts, lastAttemptAt: now, ok: false };
}

/** A busca de hoje já falhou (sem sucesso no dia): a cotação gravada vira `last_known`. */
export function fxFetchFailedToday(state: InfraFxFetchState | null, now: Date): boolean {
  return state !== null && state.referenceDay === utcDayOf(now) && state.attempts > 0 && !state.ok;
}
