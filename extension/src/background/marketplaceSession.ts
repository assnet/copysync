import { MARKETPLACES, type MarketplaceKey } from '../config/env.js';
import { getSyncState, getPendingAccess } from './store.js';
import type { MlStatusPayload, SheinStatusPayload } from '../contract/channel.js';

/**
 * Marketplace cookie reader — UNIQUE module that calls `chrome.cookies.*`.
 * Enforced by `scripts/check-cookie-scope.mjs`.
 *
 * Lê só os cookies de identidade de cada marketplace (`MARKETPLACES[key].cookies`).
 * Marketplace `optional` (Shein: `optional_host_permissions`) só é lido com
 * `chrome.permissions.contains` verdadeiro — sem permissão, nenhum cookie é tocado.
 * No content script, no tabs, no scripting. CSRF do ML vem do bootstrap do servidor.
 */

export interface CapturedCookies {
  cookies: Record<string, string>;
  hash: string;
}

const hashCookies = async (sorted: string): Promise<string> => {
  const encoded = new TextEncoder().encode(sorted);
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};

/** Permissão de host do marketplace. Obrigatório (ML) → sempre `true`. */
export const hasHostPermission = async (marketplace: MarketplaceKey): Promise<boolean> => {
  const mp = MARKETPLACES[marketplace];
  if (!mp.optional) return true;
  try {
    return await chrome.permissions.contains({ origins: [mp.MARKETPLACE_URL_PATTERN] });
  } catch {
    return false;
  }
};

/** Todos os cookies da URL do marketplace; `[]` sem permissão de host. */
const readCookies = async (marketplace: MarketplaceKey): Promise<chrome.cookies.Cookie[]> => {
  const mp = MARKETPLACES[marketplace];
  if (!(await hasHostPermission(marketplace))) return [];
  return chrome.cookies.getAll({ url: mp.MARKETPLACE_URL });
};

/** Cookies de identidade + hash; `null` sem o cookie de token (deslogado) ou sem permissão. */
export const captureCookies = async (marketplace: MarketplaceKey): Promise<CapturedCookies | null> => {
  const mp = MARKETPLACES[marketplace];
  const allCookies = await readCookies(marketplace);
  const result: Record<string, string> = {};

  for (const name of mp.cookies) {
    const matches = allCookies.filter(c => c.name === name);
    if (matches.length === 0) continue;
    // Dedupe: longest path wins (most specific)
    const best = matches.reduce((a, b) => (a.path.length >= b.path.length ? a : b));
    if (best.value) result[best.name] = best.value;
  }

  if (!result[mp.tokenCookie]) return null;
  // Shein: a API exige todos os cookies (`AT` + `memberId`); faltando um, a sessão não serve.
  if (mp.optional && mp.cookies.some(n => !result[n])) return null;

  const sorted = mp.cookies
    .filter(n => result[n])
    .map(n => `${n}=${result[n]}`)
    .join('&');
  const hash = await hashCookies(sorted);

  return { cookies: result, hash };
};

/** Compat: leitura do ML (nome da v3.3). */
export const captureMlCookies = (): Promise<CapturedCookies | null> => captureCookies('ml');

const hasSession = async (marketplace: MarketplaceKey): Promise<boolean> => {
  const token = MARKETPLACES[marketplace].tokenCookie;
  const cookies = await readCookies(marketplace);
  return cookies.some(c => c.name === token && !!c.value);
};

export const hasMlSession = (): Promise<boolean> => hasSession('ml');

export const getMlStatus = async (): Promise<MlStatusPayload> => {
  const [loggedIn, syncState] = await Promise.all([hasSession('ml'), getSyncState('ml')]);
  return {
    loggedIn,
    lastSyncAt: syncState.lastSyncAt,
    resyncRequested: false,
  };
};

/** Estado da Shein para o card do painel. Nunca carrega valor de cookie. */
export const getSheinStatus = async (): Promise<SheinStatusPayload> => {
  const granted = await hasHostPermission('shein');
  const [loggedIn, syncState, pending] = await Promise.all([
    granted ? hasSession('shein') : Promise.resolve(false),
    getSyncState('shein'),
    getPendingAccess(),
  ]);
  return {
    permission: granted ? 'granted' : 'missing',
    pending: pending?.marketplace === 'shein',
    loggedIn,
    syncStatus: syncState.status,
    lastSyncAt: syncState.lastSyncAt,
    ...(syncState.lastErrorCode ? { errorCode: syncState.lastErrorCode } : {}),
  };
};
