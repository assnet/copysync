/**
 * Central de configuração — ÚNICO ponto que lê `process.env`.
 *
 * Os valores vêm de `.env` / `.env.dev` e são substituídos pelo `dotenv-webpack`
 * no build. Qualquer outro módulo importa daqui; nunca lê `process.env` direto
 * nem escreve URL literal (ver `scripts/check-dist.mjs`).
 */
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
  /** Período do alarme de renovação da sessão do marketplace. */
  sessionSyncIntervalMinutes: Math.max(
    1,
    Number.parseInt(process.env.SESSION_SYNC_INTERVAL_MINUTES ?? '30', 10) || 30,
  ),
} as const;

/** Marketplace atendido por esta extensão. Mesmo valor do enum `AffiliateProvider` da API. */
export const AFFILIATE_PROVIDER = 'MERCADO_LIVRE' as const;

/** Domínio de cookies do marketplace. Único lugar onde o host aparece em código. */
export const MARKETPLACE_COOKIE_DOMAIN = '.mercadolivre.com.br';
export const MARKETPLACE_URL_PATTERN = 'https://*.mercadolivre.com.br/*';
export const MARKETPLACE_HOME_URL = 'https://www.mercadolivre.com.br/';
