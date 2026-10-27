import { describe, it, expect } from 'vitest';
import { assertNoSecrets } from './sanitize';

describe('assertNoSecrets', () => {
  it('strips ML session cookies from flat object', () => {
    const input = { ssid: 'secret', orguseridp: '123', name: 'safe' };
    expect(assertNoSecrets(input)).toEqual({ name: 'safe' });
  });

  it('strips ML temp cookies', () => {
    const input = { _csrf: 'tok', _d2id: 'x', _mldataSessionId: 'y', nsa_rotok: 'z', data: 1 };
    expect(assertNoSecrets(input)).toEqual({ data: 1 });
  });

  it('strips auth-related fields', () => {
    const input = { authorization: 'Bearer x', cookie: 'c=1', 'set-cookie': 'y', cookies: {}, csrf: 'z', 'x-csrf-token': 'a', safe: true };
    expect(assertNoSecrets(input)).toEqual({ safe: true });
  });

  it('strips case-insensitively', () => {
    const input = { SSID: 'x', Authorization: 'y', COOKIES: {}, ok: 1 };
    expect(assertNoSecrets(input)).toEqual({ ok: 1 });
  });

  it('strips from nested objects', () => {
    const input = { outer: { ssid: 'leaked', clean: 'ok' } };
    expect(assertNoSecrets(input)).toEqual({ outer: { clean: 'ok' } });
  });

  it('strips from objects inside arrays', () => {
    const input = { items: [{ ssid: 'x', a: 1 }, { cookie: 'y', b: 2 }] };
    expect(assertNoSecrets(input)).toEqual({ items: [{ a: 1 }, { b: 2 }] });
  });

  it('preserves null and undefined', () => {
    expect(assertNoSecrets(null)).toBeNull();
    expect(assertNoSecrets(undefined)).toBeUndefined();
  });

  it('preserves primitives', () => {
    expect(assertNoSecrets('hello')).toBe('hello');
    expect(assertNoSecrets(42)).toBe(42);
    expect(assertNoSecrets(true)).toBe(true);
  });

  it('preserves arrays of primitives', () => {
    expect(assertNoSecrets([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
