/** Site key do Turnstile (modo gerenciado). Sem ela o widget não aparece e o login segue como antes. */
export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim();
/** Mesma `action` que a API confere (CloudflareTurnstileVerifier). */
export const TURNSTILE_ACTION = 'login';
