import { MARKETPLACE_COOKIE_DOMAIN, MARKETPLACE_URL_PATTERN } from '../config/env.js';
import type { ContentRequest, ContentResponse, MarketplaceLoginCheck } from '../contract/messages.js';
import { devLog } from '../core/devLog.js';
import { SyncError } from './errors.js';

/**
 * Leitura da sessão do marketplace no navegador.
 *
 * ÚNICO módulo do projeto que chama `chrome.cookies.*`, e sempre com
 * `MARKETPLACE_COOKIE_DOMAIN` (`scripts/check-cookie-scope.mjs` garante).
 * Nunca lê cookie da própria API: a autenticação com o painel é por token.
 */
const SESSION_COOKIE_NAME = 'ssid';
const CSRF_REQUEST: ContentRequest = { type: 'page/get-csrf' };

export const getSessionCookie = async (): Promise<string | null> => {
  const cookies = await chrome.cookies.getAll({ domain: MARKETPLACE_COOKIE_DOMAIN });
  const cookie = cookies.find((c) => c.name === SESSION_COOKIE_NAME && c.value);
  return cookie?.value ?? null;
};

export const findMarketplaceTab = async (): Promise<chrome.tabs.Tab | null> => {
  const tabs = await chrome.tabs.query({ url: MARKETPLACE_URL_PATTERN });
  // Prefere aba ativa; senão a primeira já carregada.
  return tabs.find((t) => t.active) ?? tabs.find((t) => t.status === 'complete') ?? tabs[0] ?? null;
};

const askContentScript = async (tabId: number): Promise<string | null> => {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, CSRF_REQUEST)) as ContentResponse | undefined;
    return response?.csrfToken ?? null;
  } catch (error) {
    // Aba aberta antes da instalação não tem o content script injetado.
    devLog('content script silent, falling back to scripting', error);
    return null;
  }
};

/** Fallback: injeta um leitor efêmero do `meta[name="csrf-token"]` (sem closures — roda na página). */
const readCsrfViaScripting = async (tabId: number): Promise<string | null> => {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? null,
    });
    return results[0]?.result ?? null;
  } catch (error) {
    devLog('scripting.executeScript failed', error);
    return null;
  }
};

export const getCsrfToken = async (tabId: number): Promise<string | null> =>
  (await askContentScript(tabId)) ?? (await readCsrfViaScripting(tabId));

export const checkLogin = async (): Promise<MarketplaceLoginCheck> => {
  const [cookie, tab] = await Promise.all([getSessionCookie(), findMarketplaceTab()]);
  return { loggedIn: cookie !== null, hasOpenTab: tab !== null };
};

export interface CapturedSession {
  sessionToken: string;
  csrfToken: string;
}

/** Cookie → aba → CSRF. Lança `SyncError` no primeiro degrau que falhar. */
export const captureSession = async (): Promise<CapturedSession> => {
  const sessionToken = await getSessionCookie();
  if (!sessionToken) throw new SyncError('marketplace_not_logged');

  const tab = await findMarketplaceTab();
  if (!tab || typeof tab.id !== 'number') throw new SyncError('marketplace_tab_missing');

  const csrfToken = await getCsrfToken(tab.id);
  if (!csrfToken) throw new SyncError('csrf_missing', `tab ${tab.id}`);

  return { sessionToken, csrfToken };
};
