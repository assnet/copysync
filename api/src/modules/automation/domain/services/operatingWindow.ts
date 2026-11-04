import {
  ALL_WEEKDAYS_MASK,
  isFullDayRange,
  isMinuteWithinRange,
  MINUTES_PER_DAY,
  minuteOfDayInZone,
  POSTING_TIME_ZONE,
  resolveStartWithinPostingWindow,
} from '../../../campaigns/domain/services/postingWindow';

/** Delegação para `campaigns/domain/services/postingWindow` (regra única de horário de postagem). */
export { MINUTES_PER_DAY, minuteOfDayInZone };
export const MONITOR_TIME_ZONE = POSTING_TIME_ZONE;

export interface OperatingWindow {
  /** 0..1440 */
  startMinute: number;
  /** 0..1440; menor que start = cruza a meia-noite. */
  endMinute: number;
  /** Dias da semana (bit 0 = domingo); ausente = todos (127). */
  weekdaysMask?: number;
}

export function isFullDay(w: OperatingWindow): boolean {
  return isFullDayRange(w);
}

/** Só a faixa de minutos (sem dia da semana). */
export function isWithinWindow(minute: number, w: OperatingWindow): boolean {
  return isMinuteWithinRange(minute, w);
}

/**
 * Horário do 1º envio: `at` se já estiver dentro da janela; senão a próxima abertura.
 * O fim da janela só ancora o início (os envios seguintes podem passar dele, ver doc).
 */
export function resolveStartWithinWindow(at: Date, w: OperatingWindow, timeZone = MONITOR_TIME_ZONE): Date {
  return resolveStartWithinPostingWindow(
    at,
    { startMinute: w.startMinute, endMinute: w.endMinute, weekdaysMask: w.weekdaysMask ?? ALL_WEEKDAYS_MASK },
    timeZone,
  );
}
