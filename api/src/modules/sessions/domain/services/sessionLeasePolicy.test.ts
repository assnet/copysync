import { describe, it, expect } from 'vitest';
import {
  OPEN_AUTH_STATE_TIMEOUT_MS,
  USER_OPEN_AUTH_STATE_TIMEOUT_MS,
  openAuthStateTimeoutMs,
  LEASE_FENCE_MARGIN_MS,
  LEASE_RENEW_INTERVAL_MS,
  LEASE_RENEW_TIMEOUT_MS,
  LEASE_TTL_MS,
  isLeaseFenceExpired,
} from './sessionLeasePolicy';

const last = new Date('2026-11-04T10:00:00.000Z');
const after = (ms: number) => new Date(last.getTime() + ms);

describe('sessionLeasePolicy', () => {
  it('constantes 60 s / 20 s / 5 s / 5 s', () => {
    expect(LEASE_TTL_MS).toBe(60_000);
    expect(LEASE_RENEW_INTERVAL_MS).toBe(20_000);
    expect(LEASE_FENCE_MARGIN_MS).toBe(5_000);
    expect(LEASE_RENEW_TIMEOUT_MS).toBe(5_000);
  });

  it('54,9 s após a última renovação ainda é válido', () => {
    expect(isLeaseFenceExpired(last, after(54_900))).toBe(false);
  });

  it('exatamente 55 s não vence (só depois)', () => {
    expect(isLeaseFenceExpired(last, after(55_000))).toBe(false);
  });

  it('55,1 s após a última renovação está vencido', () => {
    expect(isLeaseFenceExpired(last, after(55_100))).toBe(true);
  });

  it('logo após renovar é válido', () => {
    expect(isLeaseFenceExpired(last, last)).toBe(false);
  });
});

describe('openAuthStateTimeoutMs (F14)', () => {
  it('auto 15 s, usuário 60 s', () => {
    expect(openAuthStateTimeoutMs('auto')).toBe(OPEN_AUTH_STATE_TIMEOUT_MS);
    expect(OPEN_AUTH_STATE_TIMEOUT_MS).toBe(15_000);
    expect(openAuthStateTimeoutMs('user')).toBe(USER_OPEN_AUTH_STATE_TIMEOUT_MS);
    expect(USER_OPEN_AUTH_STATE_TIMEOUT_MS).toBe(60_000);
  });
});
