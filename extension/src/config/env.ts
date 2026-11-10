/**
 * Central de configuração — ÚNICO ponto que lê `process.env`.
 *
 * Os valores vêm de `.env` / `.env.dev` e são substituídos pelo `dotenv-webpack`
 * no build. Qualquer outro módulo importa daqui; nunca lê `process.env` direto
 * nem escreve URL literal (ver `scripts/check-dist.mjs`).
 */
import { ML_SESSION_COOKIES, SHEIN_SESSION_COOKIES } from '../background/constants.js';

const trimSlash = (value: string): string => value.replace(/\/+$/, '');

export const env = {
  /** Nome exibido ao usuário. Em HTML/manifest o nome vem de `_locales`. */
  appName: (process.env.NAME_APP ?? 'App').trim(),
  /** Base da API, com prefixo `/api`, sem barra final. */
  apiUrl: trimSlash((process.env.API_URL ?? '').trim()),
  /** Painel web, sem barra final. */
  panelUrl: trimSlash((process.env.PANEL_URL ?? '').trim()),
  /** `true` só no build de desenvolvimento. */
  isDev: process.env.DEV === 'true',
  /**
   * Origens extras do painel (`DEV_ORIGINS`), SÓ no build dev. Em produção o ramo é
   * constante falsa e o Terser o elimina: nada de localhost no bundle (`check-dist`).
   */
  devOrigins: process.env.DEV === 'true'
    ? (process.env.DEV_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    : ([] as string[]),
  /** Período do alarme de renovação da sessão do marketplace. */
  sessionSyncIntervalMinutes: Math.max(
    1,
    Number.parseInt(process.env.SESSION_SYNC_INTERVAL_MINUTES ?? '30', 10) || 30,
  ),
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
