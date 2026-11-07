/**
 * Regras puras dos links de redirecionamento da plataforma (sem I/O). Os use cases traduzem as
 * falhas para `RedirectLinkInvalidError`. Ver docs/redirect-links.md.
 */

export const REDIRECT_SLUG_MAX_LENGTH = 100;
export const REDIRECT_URL_MAX_LENGTH = 2048;
export const REDIRECT_NOTE_MAX_LENGTH = 500;
/** Caminho público do painel (`/redirect/<slug>`) e prefixo da rota pública da API. */
export const REDIRECT_PANEL_PATH = '/redirect';
export const REDIRECT_API_PATH_FRAGMENT = '/public/redirects';

/** Começa e termina com letra/dígito; meio aceita `.` e `-`. */
const SLUG = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

/** Slug normalizado (trim + minúsculas) ou `null` se fora da regra. */
export function parseRedirectSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const slug = raw.trim().toLowerCase();
  if (!slug || slug.length > REDIRECT_SLUG_MAX_LENGTH) return null;
  if (!SLUG.test(slug) || slug.includes('..')) return null;
  return slug;
}

export type DestinationRejection = 'EMPTY' | 'TOO_LONG' | 'MALFORMED' | 'NOT_HTTPS' | 'CREDENTIALS' | 'LOOP';

export type DestinationResult = { ok: true; url: string } | { ok: false; reason: DestinationRejection };

function isPlatformHost(hostname: string, platformHosts: readonly string[]): boolean {
  return platformHosts.some((p) => hostname === p || hostname.endsWith(`.${p}`));
}

function decodedPath(pathname: string): string {
  try {
    return decodeURIComponent(pathname).toLowerCase();
  } catch {
    return pathname.toLowerCase();
  }
}

/**
 * Destino aceito: só `https://`, sem `user:pass@`, até 2048 caracteres e sem apontar para o
 * próprio redirecionamento (painel `/redirect…` ou API `/…/public/redirects…`) num host da
 * plataforma — evita loop. Devolve o `href` normalizado pelo parser de URL.
 */
export function validateRedirectDestination(raw: unknown, platformHosts: readonly string[]): DestinationResult {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'EMPTY' };
  const value = raw.trim();
  if (value.length > REDIRECT_URL_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'NOT_HTTPS' };
  if (url.username || url.password) return { ok: false, reason: 'CREDENTIALS' };
  if (!url.hostname) return { ok: false, reason: 'MALFORMED' };
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (isPlatformHost(host, platformHosts)) {
    const path = decodedPath(url.pathname);
    const panelLoop = path === REDIRECT_PANEL_PATH || path.startsWith(`${REDIRECT_PANEL_PATH}/`);
    if (panelLoop || path.includes(REDIRECT_API_PATH_FRAGMENT)) return { ok: false, reason: 'LOOP' };
  }
  if (url.href.length > REDIRECT_URL_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, url: url.href };
}

/** Defesa na saída: o que vai para o visitante é sempre `https://` sem credencial. */
export function isSafeRedirectTarget(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Percentual de A: inteiro 0–100, ou `null` se fora da regra. */
export function parsePercentA(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 100 ? raw : null;
}

/** Nota opcional: vazia vira `null`; acima do teto = `undefined` (inválida). */
export function parseRedirectNote(raw: unknown): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return undefined;
  const note = raw.trim();
  if (!note) return null;
  return note.length > REDIRECT_NOTE_MAX_LENGTH ? undefined : note;
}
