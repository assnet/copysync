import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCK_SECONDS, lockedUntilFrom } from './deleteLock';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const at = (s: number) => NOW + s * 1000;
const iso = (s: number) => new Date(at(s)).toISOString();

describe('lockedUntilFrom', () => {
  it('meta.retryAfterSeconds vence todos', () => {
    expect(lockedUntilFrom({ meta: { retryAfterSeconds: 60, retryAt: iso(300) }, retryAfter: '500' }, NOW)).toBe(at(60));
  });
  it('sem os segundos usa meta.retryAt', () => {
    expect(lockedUntilFrom({ meta: { retryAt: iso(300) }, retryAfter: '500' }, NOW)).toBe(at(300));
  });
  it('sem meta usa o header Retry-After em segundos ou data HTTP', () => {
    expect(lockedUntilFrom({ retryAfter: '500' }, NOW)).toBe(at(500));
    expect(lockedUntilFrom({ meta: null, retryAfter: new Date(at(120)).toUTCString() }, NOW)).toBe(at(120));
  });
  it('valor inválido ou vencido cai no próximo; sem nada, 15 min', () => {
    expect(lockedUntilFrom({ meta: { retryAfterSeconds: 0, retryAt: iso(-10) }, retryAfter: '90' }, NOW)).toBe(at(90));
    expect(lockedUntilFrom({ meta: { retryAt: 'x' }, retryAfter: 'y' }, NOW)).toBe(at(DEFAULT_LOCK_SECONDS));
    expect(lockedUntilFrom(null, NOW)).toBe(at(DEFAULT_LOCK_SECONDS));
  });
});
