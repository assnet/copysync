/** Limite do campo `baseUrl` (provedor `OPENAI_COMPATIBLE`). */
export const CUSTOM_BASE_URL_MAX_LENGTH = 300;

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.localdomain', '.home.arpa'];

export type CustomBaseUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Regra de forma da URL base de um endpoint próprio (sem rede). Aceita só `https:` na porta
 * padrão, host com nome (sem IP literal, sem userinfo), sem `localhost`/`*.local`/`*.internal`,
 * sem query nem fragmento. Devolve a URL normalizada sem barra final. A checagem de DNS
 * (endereços privados) fica no `IAiBaseUrlGuard`.
 */
export function checkCustomBaseUrl(raw: string | null | undefined): CustomBaseUrlCheck {
  const value = raw?.trim() ?? '';
  if (!value) return { ok: false, reason: 'required' };
  if (value.length > CUSTOM_BASE_URL_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (url.username || url.password) return { ok: false, reason: 'userinfo' };
  if (url.port !== '') return { ok: false, reason: 'port' };
  if (url.search || url.hash || value.includes('?') || value.includes('#')) return { ok: false, reason: 'query' };
  // WHATWG já normaliza formas numéricas (0x7f.1, 2130706433) para IPv4 pontuado.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || host.includes(':') || IPV4_LITERAL.test(host)) return { ok: false, reason: 'ip_literal' };
  if (!host.includes('.') || host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'private_host' };
  }
  const path = url.pathname.replace(/\/+$/, '');
  return { ok: true, url: `https://${host}${path}` };
}
