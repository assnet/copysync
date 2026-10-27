export const env = {
  appName: 'TestApp',
  apiUrl: 'https://api.test.local/api',
  panelUrl: 'https://app.test.local',
  isDev: false,
  sessionSyncIntervalMinutes: 30,
} as const;

export const AFFILIATE_PROVIDER = 'MERCADO_LIVRE' as const;
export const MARKETPLACE_COOKIE_DOMAIN = '.mercadolivre.com.br';
export const MARKETPLACE_URL_PATTERN = 'https://*.mercadolivre.com.br/*';
export const MARKETPLACE_HOME_URL = 'https://www.mercadolivre.com.br/';
