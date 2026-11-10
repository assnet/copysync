import { MARKETPLACES, MARKETPLACE_KEYS, type MarketplaceKey } from '../config/env.js';
import { ML_SYNC_PENDING_ALARM, SHEIN_SYNC_PENDING_ALARM, SYNC_DEBOUNCE_MS } from './constants.js';

/**
 * Filtro do `cookies.onChanged` (só o listener fica em `index.ts`; leitura de cookie é de
 * `marketplaceSession.ts`). Agenda sync só para cookie de identidade do marketplace:
 * domínio E nome (Shein: `AT`, `memberId`; outro cookie de `m.shein.com` é ignorado).
 */

export const SYNC_PENDING_ALARMS: Record<MarketplaceKey, string> = {
  ml: ML_SYNC_PENDING_ALARM,
  shein: SHEIN_SYNC_PENDING_ALARM,
};

const bareDomain = (domain: string): string => domain.replace(/^\./, '');

export const marketplaceOfCookie = (cookie: { domain: string; name: string }): MarketplaceKey | null => {
  const domain = bareDomain(cookie.domain);
  for (const key of MARKETPLACE_KEYS) {
    const mp = MARKETPLACES[key];
    if (bareDomain(mp.MARKETPLACE_COOKIE_DOMAIN) === domain && mp.cookies.includes(cookie.name)) return key;
  }
  return null;
};

/** Alarme de debounce do marketplace do cookie, ou `null` se o cookie não interessa. */
export const cookieChangeAlarm = (cookie: { domain: string; name: string }): string | null => {
  const key = marketplaceOfCookie(cookie);
  return key ? SYNC_PENDING_ALARMS[key] : null;
};

/** Debounce: um alarme por marketplace; o já agendado não é reiniciado (igual à v3.3). */
export const scheduleDebouncedSync = async (alarm: string): Promise<void> => {
  const existing = await chrome.alarms.get(alarm);
  if (existing) return;
  await chrome.alarms.create(alarm, { delayInMinutes: SYNC_DEBOUNCE_MS / 60_000 });
};
