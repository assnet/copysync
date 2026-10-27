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
