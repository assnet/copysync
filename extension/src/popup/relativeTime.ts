import { t } from '../core/i18n.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Converte um ISO 8601 em texto relativo curto ("há 5 min") usando as chaves `time_*`. */
export const relativeTime = (iso: string, now: number = Date.now()): string => {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  if (diff < MIN) return t('time_just_now');
  if (diff < HOUR) return t('time_minutes_ago', Math.floor(diff / MIN));
  if (diff < DAY) return t('time_hours_ago', Math.floor(diff / HOUR));
  return t('time_days_ago', Math.floor(diff / DAY));
};
