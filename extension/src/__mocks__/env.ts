import { ML_SESSION_COOKIES, SHEIN_SESSION_COOKIES } from '../background/constants.js';

export const env = {
  appName: 'TestApp',
  apiUrl: 'https://api.test.local/api',
  panelUrl: 'https://app.test.local',
  isDev: false,
  devOrigins: [] as string[],
  sessionSyncIntervalMinutes: 30,
} as const;

/** Chave do marketplace na extensão (também o segmento `/marketplaces/<key>/session` da API). */
export type MarketplaceKey = 'ml' | 'shein';

export interface MarketplaceConfig {
  /** Mesmo valor do enum `AffiliateProvider` da API. */
  provider: 'MERCADO_LIVRE' | 'SHEIN';
  /** Domínio de cookies. Único lugar onde o host aparece em código. */
  MARKETPLACE_COOKIE_DOMAIN: string;
  /** Padrão de host (manifest/permissão). */
  MARKETPLACE_URL_PATTERN: string;
  /** URL concreta passada a `cookies.getAll`. */
  MARKETPLACE_URL: string;
  /** Cookies de identidade enviados à API. */
  cookies: readonly string[];
  /** Sem este cookie não há login. */
  tokenCookie: string;
  /** Host em `optional_host_permissions`: só lê cookie com `chrome.permissions.contains`. */
  optional: boolean;
}

export const MARKETPLACES: Record<MarketplaceKey, MarketplaceConfig> = {
  ml: {
    provider: 'MERCADO_LIVRE',
    MARKETPLACE_COOKIE_DOMAIN: '.mercadolivre.com.br',
    MARKETPLACE_URL_PATTERN: 'https://*.mercadolivre.com.br/*',
    MARKETPLACE_URL: 'https://www.mercadolivre.com.br/',
    cookies: ML_SESSION_COOKIES,
    tokenCookie: 'ssid',
    optional: false,
  },
  shein: {
    provider: 'SHEIN',
    MARKETPLACE_COOKIE_DOMAIN: 'm.shein.com',
    MARKETPLACE_URL_PATTERN: 'https://m.shein.com/*',
    MARKETPLACE_URL: 'https://m.shein.com/',
    cookies: SHEIN_SESSION_COOKIES,
    tokenCookie: 'AT',
    optional: true,
  },
};

export const MARKETPLACE_KEYS = Object.keys(MARKETPLACES) as MarketplaceKey[];
