import { startOfDayInZone } from '../../../campaigns/domain/services/startOfDayInZone';

export const MINUTES_PER_DAY = 1440;
export const MONITOR_TIME_ZONE = 'America/Sao_Paulo';

export interface OperatingWindow {
  /** 0..1440 */
  startMinute: number;
  /** 0..1440; menor que start = cruza a meia-noite. */
  endMinute: number;
}

export function isFullDay(w: OperatingWindow): boolean {
  return w.startMinute === 0 && w.endMinute === MINUTES_PER_DAY;
}

/** Minuto do dia (0..1439) de `at` no fuso. */
export function minuteOfDayInZone(at: Date, timeZone = MONITOR_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')!.value);
  const m = Number(parts.find((p) => p.type === 'minute')!.value);
  return h * 60 + m;
}

export function isWithinWindow(minute: number, w: OperatingWindow): boolean {
  if (isFullDay(w)) return true;
  if (w.startMinute <= w.endMinute) return minute >= w.startMinute && minute < w.endMinute;
  return minute >= w.startMinute || minute < w.endMinute;
}

/**
 * Horário do 1º envio: `at` se já estiver dentro da janela; senão o próximo início da janela.
 * O fim da janela só ancora o início (os envios seguintes podem passar dele, ver doc).
 */
export function resolveStartWithinWindow(at: Date, w: OperatingWindow, timeZone = MONITOR_TIME_ZONE): Date {
  if (isWithinWindow(minuteOfDayInZone(at, timeZone), w)) return at;
  const midnight = startOfDayInZone(at, timeZone).getTime();
  let next = midnight + w.startMinute * 60_000;
  if (next <= at.getTime()) next = startOfDayInZone(new Date(midnight + 26 * 3_600_000), timeZone).getTime() + w.startMinute * 60_000;
  return new Date(next);
}
