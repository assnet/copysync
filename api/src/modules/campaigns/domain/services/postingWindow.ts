import { startOfDayInZone } from './startOfDayInZone';

export const MINUTES_PER_DAY = 1440;
export const POSTING_TIME_ZONE = 'America/Sao_Paulo';
/** Bit 0 = domingo … bit 6 = sábado; 127 = todos os dias. */
export const ALL_WEEKDAYS_MASK = 127;

export interface PostingWindow {
  /** 0..1440 */
  startMinute: number;
  /** 0..1440; menor que start = cruza a meia-noite (o trecho após 00:00 pertence ao dia do início). */
  endMinute: number;
  /** 1..127; 0 é inválido. */
  weekdaysMask: number;
}

export function isValidWeekdaysMask(mask: number): boolean {
  return Number.isInteger(mask) && mask >= 1 && mask <= ALL_WEEKDAYS_MASK;
}

/** Lista de dias (0 = domingo … 6 = sábado) → mask. Dia fora de 0..6 lança. */
export function weekdaysMask(days: readonly number[]): number {
  let mask = 0;
  for (const d of days) {
    if (!Number.isInteger(d) || d < 0 || d > 6) throw new RangeError(`weekday inválido: ${d}`);
    mask |= 1 << d;
  }
  return mask;
}

/** Mask → lista ordenada de dias (0..6). */
export function weekdaysFromMask(mask: number): number[] {
  const days: number[] = [];
  for (let d = 0; d < 7; d += 1) if (mask & (1 << d)) days.push(d);
  return days;
}

export function hasWeekday(mask: number, weekday: number): boolean {
  return (mask & (1 << weekday)) !== 0;
}

export function isFullDayRange(w: Pick<PostingWindow, 'startMinute' | 'endMinute'>): boolean {
  return w.startMinute === 0 && w.endMinute === MINUTES_PER_DAY;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Dia da semana (0 = domingo) de `at` no fuso. */
export function weekdayInZone(at: Date, timeZone = POSTING_TIME_ZONE): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at);
  return WEEKDAY_INDEX[name]!;
}

/** Minuto do dia (0..1439) de `at` no fuso. */
export function minuteOfDayInZone(at: Date, timeZone = POSTING_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')!.value);
  const m = Number(parts.find((p) => p.type === 'minute')!.value);
  return h * 60 + m;
}

/** Só a faixa de minutos, sem dia da semana. */
export function isMinuteWithinRange(minute: number, w: Pick<PostingWindow, 'startMinute' | 'endMinute'>): boolean {
  if (isFullDayRange(w)) return true;
  if (w.startMinute <= w.endMinute) return minute >= w.startMinute && minute < w.endMinute;
  return minute >= w.startMinute || minute < w.endMinute;
}

/**
 * `at` cai na janela? Faixa que cruza a meia-noite: o trecho até 23:59 usa o dia de hoje,
 * o trecho após 00:00 usa o dia anterior (dia do início). Mask inválido = nunca.
 */
export function isWithinPostingWindow(at: Date, w: PostingWindow, timeZone = POSTING_TIME_ZONE): boolean {
  if (!isValidWeekdaysMask(w.weekdaysMask)) return false;
  const minute = minuteOfDayInZone(at, timeZone);
  if (!isMinuteWithinRange(minute, w)) return false;
  const today = weekdayInZone(at, timeZone);
  const crossesMidnight = !isFullDayRange(w) && w.startMinute > w.endMinute;
  const startDay = crossesMidnight && minute < w.endMinute ? (today + 6) % 7 : today;
  return hasWeekday(w.weekdaysMask, startDay);
}

/**
 * Horário do 1º envio: `at` se já estiver dentro da janela; senão a próxima abertura
 * (início da faixa num dia do mask), em até 7 dias. O fim só ancora o início.
 * Mask inválido lança `RangeError`.
 */
export function resolveStartWithinPostingWindow(at: Date, w: PostingWindow, timeZone = POSTING_TIME_ZONE): Date {
  if (!isValidWeekdaysMask(w.weekdaysMask)) throw new RangeError(`weekdaysMask inválido: ${w.weekdaysMask}`);
  if (isWithinPostingWindow(at, w, timeZone)) return at;
  let midnight = startOfDayInZone(at, timeZone).getTime();
  for (let k = 0; k <= 7; k += 1) {
    const candidate = midnight + w.startMinute * 60_000;
    if (candidate > at.getTime() && hasWeekday(w.weekdaysMask, weekdayInZone(new Date(midnight), timeZone))) {
      return new Date(candidate);
    }
    midnight = startOfDayInZone(new Date(midnight + 26 * 3_600_000), timeZone).getTime();
  }
  /* inalcançável com mask válido */
  throw new RangeError('janela de postagem sem abertura em 7 dias');
}
