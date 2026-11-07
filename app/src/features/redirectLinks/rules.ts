import { REDIRECT_PUBLIC_PATH } from './strings';

/** Mesma regra da API (a API é a fonte da verdade; aqui só para avisar antes de enviar). */
const SLUG = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
export const SLUG_MAX = 100;
export const URL_MAX = 2048;
export const NOTE_MAX = 500;

export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidSlug(raw: string): boolean {
  const s = normalizeSlug(raw);
  return s.length > 0 && s.length <= SLUG_MAX && SLUG.test(s) && !s.includes('..');
}

/** `https://` válido, sem usuário/senha e até 2048 caracteres. */
export function isHttpsUrl(raw: string): boolean {
  const v = raw.trim();
  if (!v || v.length > URL_MAX) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/** Endereço público completo, na origem do painel aberto. */
export function publicRedirectUrl(slug: string, origin: string = window.location.origin): string {
  return `${origin}${REDIRECT_PUBLIC_PATH}/${encodeURIComponent(slug)}`;
}
