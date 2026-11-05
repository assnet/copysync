import { postingWindowStrings as t } from './postingWindowStrings';
import {
  activeMinutes, formatMinuteOfDay, isAllWeekdays, isFullDay, maskToWeekdays, windowBounds, type OperatingWindow,
} from '@/features/monitoring/utils/operatingWindow';

const WEEK_MASK = 62;
const WEEKEND_MASK = 65;

/** Dias da semana legíveis: "Todos os dias", "Segunda a sexta", "Fim de semana" ou a lista curta. */
export function postingDaysSummary(mask: number): string {
  if (isAllWeekdays(mask)) return t.daysAll;
  if (mask === WEEK_MASK) return t.daysWeek;
  if (mask === WEEKEND_MASK) return t.daysWeekend;
  return t.daysList(maskToWeekdays(mask));
}

/**
 * Resumo do horário de postagem (faixa + dias), o mesmo da pílula do `PostingWindowField`.
 * Reutilizado onde o horário só é revisto (ex.: passo Confirmar do gerador).
 */
export function postingWindowSummary(value: { window: OperatingWindow; weekdaysMask: number }) {
  const { window: win, weekdaysMask } = value;
  const full = isFullDay(win);
  const { start, end } = windowBounds(win);
  const duration = t.formatDuration(activeMinutes(win));
  const s = formatMinuteOfDay(start);
  const e = formatMinuteOfDay(end);
  return {
    range: full ? t.fullDay : t.range(s, e, duration),
    rangeAria: full ? t.fullDay : t.rangeAria(s, e, duration),
    days: postingDaysSummary(weekdaysMask),
  };
}
