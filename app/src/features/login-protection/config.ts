/**
 * Site key de reserva do Turnstile. A fonte é a API (`GET /auth/login/config`); esta só vale
 * quando a config não carrega. Ver docs/seguranca-login.md.
 */
export const FALLBACK_TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim();
/** Mesma `action` que a API confere (CloudflareTurnstileVerifier). */
export const TURNSTILE_ACTION = 'login';
