/**
 * Janela de operação do monitoramento (minutos do dia, 0..1440). O slider sempre trabalha com
 * `lo <= hi`; com `overnight` a janela ativa é o complemento (cruza a meia-noite).
 * Na API: `end < start` = cruza a meia-noite; `0..1440` = sem restrição.
 */
export const DAY_MINUTES = 1440;
export const WINDOW_STEP = 15;

export interface OperatingWindow {
  lo: number;
  hi: number;
  overnight: boolean;
}

/** `HH:MM`; 1440 vira `24:00`. */
export function formatMinuteOfDay(minute: number): string {
  const m = Math.max(0, Math.min(DAY_MINUTES, Math.round(minute)));
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Inverso de `formatMinuteOfDay`; `null` se não for `HH:MM` válido. */
export function parseMinuteOfDay(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 24 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
}

export function windowFromSettings(start: number, end: number): OperatingWindow {
  return end < start ? { lo: end, hi: start, overnight: true } : { lo: start, hi: end, overnight: false };
}

export function windowToSettings(w: OperatingWindow): { windowStartMinute: number; windowEndMinute: number } {
  return w.overnight ? { windowStartMinute: w.hi, windowEndMinute: w.lo } : { windowStartMinute: w.lo, windowEndMinute: w.hi };
}

/** Minutos por dia em que o envio pode acontecer. */
export function activeMinutes(w: OperatingWindow): number {
  return w.overnight ? DAY_MINUTES - (w.hi - w.lo) : w.hi - w.lo;
}

export function isFullDay(w: OperatingWindow): boolean {
  return activeMinutes(w) >= DAY_MINUTES;
}

/** Janela vazia (ou menor que um passo) não envia nunca. */
export function isWindowValid(w: OperatingWindow): boolean {
  return activeMinutes(w) >= WINDOW_STEP;
}

/** Início e fim reais da janela ativa. */
export function windowBounds(w: OperatingWindow): { start: number; end: number } {
  return w.overnight ? { start: w.hi, end: w.lo } : { start: w.lo, end: w.hi };
}

/** Rótulos 00/03/…/21/24 sob o slider. */
export const WINDOW_MARKS = Array.from({ length: 9 }, (_, i) => ({ value: i * 180, label: String(i * 3).padStart(2, '0') }));

/**
 * Dias da semana da janela (`weekdaysMask`): bit 0 = domingo … bit 6 = sábado; 127 = todos.
 * Mask 0 é inválido (nunca envia). A API recebe a lista `weekdays` (0–6); o banco guarda o mask.
 */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const ALL_WEEKDAYS_MASK = 127;

export function weekdaysToMask(days: readonly number[]): number {
  return days.reduce((mask, d) => (Number.isInteger(d) && d >= 0 && d <= 6 ? mask | (1 << d) : mask), 0);
}

export function maskToWeekdays(mask: number): number[] {
  return WEEKDAYS.filter((d) => (mask & (1 << d)) !== 0);
}

export function isWeekdaysMaskValid(mask: number): boolean {
  return Number.isInteger(mask) && mask > 0 && mask <= ALL_WEEKDAYS_MASK;
}

export function isAllWeekdays(mask: number): boolean {
  return (mask & ALL_WEEKDAYS_MASK) === ALL_WEEKDAYS_MASK;
}

/** Liga/desliga um dia; nunca deixa o mask vazio (o último dia não sai). */
export function toggleWeekday(mask: number, day: number): number {
  const next = mask ^ (1 << day);
  return next & ALL_WEEKDAYS_MASK ? next & ALL_WEEKDAYS_MASK : mask;
}
