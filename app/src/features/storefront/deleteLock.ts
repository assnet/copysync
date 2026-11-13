import type { StorefrontApiError } from './types';

/** Bloqueio sem prazo na resposta: a janela da API é de 15 min. */
export const DEFAULT_LOCK_SECONDS = 15 * 60;

const seconds = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const instant = (v: unknown, now: number): number | null => {
  const ms = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(ms) && ms > now ? ms : null;
};

/**
 * Até quando (ms, relógio do servidor) a confirmação de senha fica bloqueada após o 429
 * `PASSWORD_CONFIRMATION_LOCKED`. Ordem: `meta.retryAfterSeconds` → `meta.retryAt` (ISO) →
 * header `Retry-After` (segundos ou data HTTP, exposto pelo `apiClient`) → 15 min.
 */
export function lockedUntilFrom(err: unknown, now: number): number {
  const e = (err ?? {}) as StorefrontApiError;
  const metaSeconds = seconds(typeof e.meta?.retryAfterSeconds === 'number' ? e.meta.retryAfterSeconds : null);
  if (metaSeconds) return now + metaSeconds * 1000;
  const headerSeconds = seconds(e.retryAfter);
  return instant(e.meta?.retryAt, now)
    ?? (headerSeconds ? now + headerSeconds * 1000 : instant(e.retryAfter, now))
    ?? now + DEFAULT_LOCK_SECONDS * 1000;
}
