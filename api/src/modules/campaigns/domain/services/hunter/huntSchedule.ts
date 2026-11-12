import { POSTING_TIME_ZONE, resolveStartWithinPostingWindow, type PostingWindow } from '../postingWindow';
import { startOfDayInZone } from '../startOfDayInZone';
import { HUNTER_LIMITS } from './hunterLimits';

export interface HuntSchedule extends PostingWindow {
  /** inteiro ≥ 30 */
  intervalMinutes: number;
}

function assertInterval(min: number): void {
  if (!Number.isInteger(min) || min < HUNTER_LIMITS.intervalMinutesMin) {
    throw new RangeError(`intervalMinutes inválido: ${min}`);
  }
}

/**
 * Próxima execução: `now + intervalMinutes`, empurrada para a próxima abertura da janela/dia se cair fora
 * (mesma regra e fuso do gerador, `postingWindow.ts`). Intervalo < 30 ou mask inválido lança `RangeError`.
 */
export function nextHuntRunAt(now: Date, schedule: HuntSchedule, timeZone = POSTING_TIME_ZONE): Date {
  assertInterval(schedule.intervalMinutes);
  return resolveStartWithinPostingWindow(new Date(now.getTime() + schedule.intervalMinutes * 60_000), schedule, timeZone);
}

/**
 * Teto do dia zerado (HUNT-16): primeira abertura da janela a partir da meia-noite seguinte no fuso.
 */
export function nextHuntRunNextDay(now: Date, schedule: HuntSchedule, timeZone = POSTING_TIME_ZONE): Date {
  assertInterval(schedule.intervalMinutes);
  // +26 h a partir da meia-noite cobre dia de 23/25 h; startOfDayInZone volta para a meia-noite seguinte
  const tomorrow = startOfDayInZone(new Date(startOfDayInZone(now, timeZone).getTime() + 26 * 3_600_000), timeZone);
  return resolveStartWithinPostingWindow(tomorrow, schedule, timeZone);
}
