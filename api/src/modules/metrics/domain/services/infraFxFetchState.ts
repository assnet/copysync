/**
 * Agenda da busca automática da cotação (COST-06a, P2). Estado em `platform_settings["infra_fx_fetch_state"]`,
 * nunca em memória: sobrevive a reinício e à troca do processo dono do job. Puro, sem I/O.
 *
 * Regra: 1×/dia (UTC) a partir de 16h30 UTC (PTAX sai ~13h de Brasília); PTAX → SGS; as duas falhando,
 * mantém a última gravada e faz no máximo 1 nova tentativa 1 h depois. Tentativa conta antes da busca
 * (processo que cai no meio não ganha tentativa extra).
 *
 * **Sem cotação** (nenhuma gravada, ou a última com `referenceDate` há mais de 4 dias): busca já, em qualquer
 * horário (a fonte devolve a última disponível, ex.: a do dia útil anterior). Antes de 16h30 é uma rodada
 * própria do dia (mesmo limite de tentativas e espera de 1 h); a rodada das 16h30 continua valendo depois dela.
 * A rodada de uma tentativa sai do horário dela (antes/depois de 16h30): sem campo novo no estado.
 */

/** Minutos do dia (UTC) a partir dos quais a busca do dia pode sair. */
export const INFRA_FX_FETCH_AFTER_UTC_MINUTES = 16 * 60 + 30;
export const INFRA_FX_FETCH_RETRY_DELAY_MS = 3_600_000;
/** 1ª tentativa + 1 nova tentativa. */
export const INFRA_FX_FETCH_MAX_ATTEMPTS = 2;
/** Última cotação gravada com `referenceDate` mais velho que isto = sem cotação (busca fora do horário). */
export const INFRA_FX_MISSING_AFTER_DAYS = 4;
const DAY_MS = 86_400_000;

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

const utcMinutes = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
const inDailyWindow = (d: Date) => utcMinutes(d) >= INFRA_FX_FETCH_AFTER_UTC_MINUTES;

/** Sem cotação utilizável: nenhuma gravada ou a última com `referenceDate` há mais de 4 dias. */
export function isFxRateMissing(latestReferenceDate: Date | null, now: Date): boolean {
  return latestReferenceDate === null || now.getTime() - latestReferenceDate.getTime() > INFRA_FX_MISSING_AFTER_DAYS * DAY_MS;
}

/** O estado é da mesma rodada de `now` (mesmo dia UTC e mesmo lado das 16h30)? */
const sameRound = (state: InfraFxFetchState | null, now: Date): state is InfraFxFetchState =>
  state !== null && state.referenceDay === utcDayOf(now) && inDailyWindow(state.lastAttemptAt) === inDailyWindow(now);

/**
 * A busca deve sair agora? `latestReferenceDate` = `referenceDate` da última cotação gravada (null = nenhuma).
 * Fora da janela das 16h30 só sai sem cotação; dentro, a regra diária de sempre.
 */
export function isFxFetchDue(state: InfraFxFetchState | null, now: Date, latestReferenceDate: Date | null): boolean {
  if (!inDailyWindow(now) && !isFxRateMissing(latestReferenceDate, now)) return false;
  if (!sameRound(state, now)) return true;
  if (state.ok || state.attempts >= INFRA_FX_FETCH_MAX_ATTEMPTS) return false;
  return now.getTime() - state.lastAttemptAt.getTime() >= INFRA_FX_FETCH_RETRY_DELAY_MS;
}

/** Estado gravado antes da busca (conta a tentativa na rodada). */
export function startFxFetchAttempt(state: InfraFxFetchState | null, now: Date): InfraFxFetchState {
  const attempts = sameRound(state, now) ? state.attempts + 1 : 1;
  return { referenceDay: utcDayOf(now), attempts, lastAttemptAt: now, ok: false };
}

/** A busca de hoje já falhou (sem sucesso no dia): a cotação gravada vira `last_known`. */
export function fxFetchFailedToday(state: InfraFxFetchState | null, now: Date): boolean {
  return state !== null && state.referenceDay === utcDayOf(now) && state.attempts > 0 && !state.ok;
}
