import { MARKETPLACE_COOKIE_DOMAIN } from '../config/env.js';
import { ML_SESSION_COOKIES } from './constants.js';
import { devLog } from '../core/devLog.js';
import { getSyncState, getMlCookieHash } from './store.js';
import type { MlStatusPayload } from '../contract/channel.js';

/**
 * ML cookie reader — UNIQUE module that calls `chrome.cookies.*`.
 * Enforced by `scripts/check-cookie-scope.mjs`.
 *
 * v3: reads only `ML_SESSION_COOKIES` (identity cookies).
 * No content script, no tabs, no scripting. CSRF comes from server bootstrap.
 */

const MARKETPLACE_URL = 'https://www.mercadolivre.com.br/';

export interface CapturedCookies {
  cookies: Record<string, string>;
  hash: string;
}

const hashCookies = async (sorted: string): Promise<string> => {
  const encoded = new TextEncoder().encode(sorted);
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};

export const captureMlCookies = async (): Promise<CapturedCookies | null> => {
  const allCookies = await chrome.cookies.getAll({ url: MARKETPLACE_URL });

  const sessionSet = new Set<string>(ML_SESSION_COOKIES);
  const result: Record<string, string> = {};

  for (const name of ML_SESSION_COOKIES) {
    const matches = allCookies.filter(c => c.name === name && sessionSet.has(c.name));
    if (matches.length === 0) continue;
    // Dedupe: longest path wins (most specific)
    const best = matches.reduce((a, b) => (a.path.length >= b.path.length ? a : b));
    if (best.value && !best.session) {
      result[best.name] = best.value;
    }
  }

  if (!result.ssid) return null;

  const sorted = ML_SESSION_COOKIES
    .filter(n => result[n])
    .map(n => `${n}=${result[n]}`)
    .join('&');
  const hash = await hashCookies(sorted);

  return { cookies: result, hash };
};

export const hasMlSession = async (): Promise<boolean> => {
  const cookies = await chrome.cookies.getAll({ url: MARKETPLACE_URL });
  return cookies.some(c => c.name === 'ssid' && c.value);
};

export const getMlStatus = async (): Promise<MlStatusPayload> => {
  const [loggedIn, syncState] = await Promise.all([hasMlSession(), getSyncState()]);
  return {
    loggedIn,
    lastSyncAt: syncState.lastSyncAt,
    resyncRequested: false,
  };
};
