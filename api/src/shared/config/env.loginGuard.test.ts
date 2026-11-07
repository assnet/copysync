import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = { DATABASE_URL: 'postgresql://t:t@localhost:5432/t', JWT_SECRET: 'x'.repeat(40), NODE_ENV: 'test', CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
const parse = (extra: Record<string, string>) => {
  const r = parseEnv({ ...base, ...extra });
  if (!r.success) throw r.error;
  return r.data;
};

describe('env da proteção do login', () => {
  it('padrão: monitor, código desligado, sem secret', () => {
    const e = parse({ TURNSTILE_SECRET_KEY: ' ' });
    expect(e).toMatchObject({ LOGIN_GUARD_MODE: 'monitor', LOGIN_EMAIL_OTP: false });
    expect(e.TURNSTILE_SECRET_KEY).toBeUndefined();
    expect(parse({ TURNSTILE_SITE_KEY: '' }).TURNSTILE_SITE_KEY).toBeUndefined();
    expect(parse({ TURNSTILE_SITE_KEY: '0xABC' }).TURNSTILE_SITE_KEY).toBe('0xABC');
  });
  it('aceita off/ENFORCE e on/true', () => {
    expect(parse({ LOGIN_GUARD_MODE: ' ENFORCE ', LOGIN_EMAIL_OTP: 'on' })).toMatchObject({ LOGIN_GUARD_MODE: 'enforce', LOGIN_EMAIL_OTP: true });
    expect(parse({ LOGIN_GUARD_MODE: 'off', LOGIN_EMAIL_OTP: 'true' })).toMatchObject({ LOGIN_GUARD_MODE: 'off', LOGIN_EMAIL_OTP: true });
    expect(parse({ LOGIN_EMAIL_OTP: 'off' }).LOGIN_EMAIL_OTP).toBe(false);
  });
  it('modo inválido derruba a validação', () => {
    expect(parseEnv({ ...base, LOGIN_GUARD_MODE: 'strict' }).success).toBe(false);
  });
});
