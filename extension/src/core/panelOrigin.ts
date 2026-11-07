import { env } from '../config/env.js';

/**
 * Portão de ORIGEM do painel — fonte única para o proxy (content script e service worker).
 * Mesmas origens do `externally_connectable` montado no `webpack.js`: `PANEL_URL` e, só no
 * build dev, `DEV_ORIGINS`. Comparação EXATA de origem (esquema + host + porta), nunca prefixo:
 * `https://app.copysync.app.evil.com` não passa.
 */
const toOrigin = (value: string): string | null => {
  try {
    return new URL(value.replace(/\/\*$/, '')).origin;
  } catch {
    return null;
  }
};

export const buildPanelOrigins = (panelUrl: string, devOrigins: readonly string[]): string[] => {
  const out = new Set<string>();
  for (const v of [panelUrl, ...devOrigins]) {
    const o = v ? toOrigin(v) : null;
    if (o && o !== 'null') out.add(o);
  }
  return [...out];
};

const PANEL_ORIGINS: readonly string[] = buildPanelOrigins(env.panelUrl, env.isDev ? env.devOrigins : []);

export const isPanelOrigin = (origin: unknown): boolean =>
  typeof origin === 'string' && PANEL_ORIGINS.includes(origin);
