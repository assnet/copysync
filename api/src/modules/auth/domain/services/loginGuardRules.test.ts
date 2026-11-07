import { describe, expect, it } from 'vitest';
import {
  LOGIN_GUARD_LIMITS as L,
  evaluateCodeSend,
  evaluateLoginBlock,
  isEmailSuspicious,
  loginCodeUsability,
  nextCodeSendAt,
  normalizeLoginEmail,
  resolveLoginGuardPolicy,
  slidingWindowRetryAt,
} from './loginGuardRules';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const min = 60_000;
const ago = (m: number) => new Date(NOW - m * min);

describe('resolveLoginGuardPolicy', () => {
  it('off: nada; monitor: só bloqueio; enforce: Turnstile (com secret) + código (com flag)', () => {
    expect(resolveLoginGuardPolicy({ LOGIN_GUARD_MODE: 'off', LOGIN_EMAIL_OTP: true, TURNSTILE_SECRET_KEY: 's', TURNSTILE_SITE_KEY: 'k' }))
      .toMatchObject({ enforceBlock: false, requireTurnstile: false, requireEmailCode: false });
    expect(resolveLoginGuardPolicy({ LOGIN_GUARD_MODE: 'monitor', LOGIN_EMAIL_OTP: true, TURNSTILE_SECRET_KEY: 's', TURNSTILE_SITE_KEY: 'k' }))
      .toMatchObject({ enforceBlock: true, requireTurnstile: false, requireEmailCode: false });
    expect(resolveLoginGuardPolicy({ LOGIN_GUARD_MODE: 'enforce', LOGIN_EMAIL_OTP: true, TURNSTILE_SECRET_KEY: 's', TURNSTILE_SITE_KEY: 'k' }))
      .toMatchObject({ enforceBlock: true, requireTurnstile: true, requireEmailCode: true, warnings: [] });
  });
  it('enforce sem o par site key + secret pula o Turnstile com aviso', () => {
    const p = resolveLoginGuardPolicy({ LOGIN_GUARD_MODE: 'enforce', LOGIN_EMAIL_OTP: false });
    expect(p.requireTurnstile).toBe(false);
    expect(p.requireEmailCode).toBe(false);
    expect(p.warnings[0]).toMatch(/TURNSTILE_SITE_KEY/);
    expect(resolveLoginGuardPolicy({ LOGIN_GUARD_MODE: 'enforce', LOGIN_EMAIL_OTP: false, TURNSTILE_SECRET_KEY: 's' }).requireTurnstile).toBe(false);
    expect(resolveLoginGuardPolicy({ LOGIN_GUARD_MODE: 'enforce', LOGIN_EMAIL_OTP: false, TURNSTILE_SITE_KEY: 'k' }).requireTurnstile).toBe(false);
  });
});

describe('janela e bloqueio', () => {
  it('normaliza e-mail', () => expect(normalizeLoginEmail('  Ana@X.com ')).toBe('ana@x.com'));

  it('2 falhas na hora: livre; 3: bloqueado até a mais antiga + 1 h', () => {
    expect(evaluateLoginBlock({ emailFailures: [ago(50), ago(10)], ipFailures: [], now: NOW })).toEqual({ blocked: false });
    const d = evaluateLoginBlock({ emailFailures: [ago(10), ago(50), ago(30)], ipFailures: [], now: NOW });
    expect(d).toEqual({ blocked: true, reason: 'EMAIL', retryAt: new Date(NOW - 50 * min + L.windowMs) });
  });

  it('falha fora da janela não conta; bloqueio vence no retryAt', () => {
    const fails = [ago(61), ago(30), ago(5)];
    expect(evaluateLoginBlock({ emailFailures: fails, ipFailures: [], now: NOW }).blocked).toBe(false);
    const three = [ago(59), ago(30), ago(5)];
    const d = evaluateLoginBlock({ emailFailures: three, ipFailures: [], now: NOW });
    expect(d.blocked && d.retryAt.getTime()).toBe(NOW + 1 * min);
    expect(evaluateLoginBlock({ emailFailures: three, ipFailures: [], now: NOW + 1 * min }).blocked).toBe(false);
  });

  it('mais de 3 falhas: libera quando sobrarem 2 (ts[n-3] + 1 h)', () => {
    expect(slidingWindowRetryAt([ago(50), ago(40), ago(30), ago(20)], 3, NOW, L.windowMs)).toEqual(new Date(NOW - 40 * min + L.windowMs));
  });

  it('IP: 10 falhas/h bloqueia; vale o horário mais distante', () => {
    const ip = Array.from({ length: 10 }, (_, i) => ago(55 - i));
    const d = evaluateLoginBlock({ emailFailures: [ago(58), ago(57), ago(56)], ipFailures: ip, now: NOW });
    expect(d).toMatchObject({ blocked: true, reason: 'IP', retryAt: new Date(NOW - 55 * min + L.windowMs) });
    expect(evaluateLoginBlock({ emailFailures: [], ipFailures: ip.slice(1), now: NOW }).blocked).toBe(false);
  });
});

describe('suspeita do e-mail', () => {
  it('3 falhas numa mesma hora: suspeito mesmo depois do bloqueio vencer', () => {
    expect(isEmailSuspicious([ago(300), ago(290), ago(280)], NOW)).toBe(true);
  });
  it('3 falhas espalhadas (> 1 h entre a 1ª e a 3ª): não suspeito', () => {
    expect(isEmailSuspicious([ago(200), ago(120), ago(10)], NOW)).toBe(false);
  });
  it('além do lookback não conta', () => {
    const old = NOW - L.suspicionLookbackMs - min;
    expect(isEmailSuspicious([new Date(old), new Date(old + min), new Date(old + 2 * min)], NOW)).toBe(false);
  });
});

describe('teto de códigos', () => {
  it('3 envios na hora: aguarde até o mais antigo + 1 h', () => {
    expect(evaluateCodeSend([ago(50), ago(30), ago(10)], NOW)).toEqual({ allowed: false, retryAt: new Date(NOW - 50 * min + L.windowMs) });
  });
  it('intervalo mínimo entre envios', () => {
    expect(evaluateCodeSend([new Date(NOW - 20_000)], NOW)).toEqual({ allowed: false, retryAt: new Date(NOW - 20_000 + L.resendCooldownMs) });
    expect(evaluateCodeSend([ago(2)], NOW)).toEqual({ allowed: true });
    expect(nextCodeSendAt([new Date(NOW)], NOW)).toEqual(new Date(NOW + L.resendCooldownMs));
  });
  it('teto diário: 2 códigos esgotados em 24 h travam até o que completou o teto + 24 h', () => {
    const h = 60 * min;
    expect(evaluateCodeSend([], NOW, [new Date(NOW - 20 * h)])).toEqual({ allowed: true });
    expect(evaluateCodeSend([], NOW, [new Date(NOW - 20 * h), new Date(NOW - 2 * h)])).toEqual({ allowed: false, retryAt: new Date(NOW - 20 * h + L.dayMs) });
    expect(evaluateCodeSend([], NOW, [new Date(NOW - 25 * h), new Date(NOW - 2 * h)])).toEqual({ allowed: true });
  });
});

describe('uso do código', () => {
  const base = { attempts: 0, expiresAt: new Date(NOW + min), consumedAt: null, invalidatedAt: null };
  it('válido, vencido, consumido, invalidado e esgotado', () => {
    expect(loginCodeUsability(base, NOW)).toBe('USABLE');
    expect(loginCodeUsability({ ...base, expiresAt: new Date(NOW) }, NOW)).toBe('EXPIRED');
    expect(loginCodeUsability({ ...base, consumedAt: new Date() }, NOW)).toBe('EXPIRED');
    expect(loginCodeUsability({ ...base, invalidatedAt: new Date() }, NOW)).toBe('EXPIRED');
    expect(loginCodeUsability({ ...base, attempts: L.maxCodeAttempts }, NOW)).toBe('EXHAUSTED');
  });
});

describe('relógio do banco à frente', () => {
  it('falha com createdAt depois do `now` da aplicação conta no teto', () => {
    const later = [new Date(NOW + 5), new Date(NOW + 9), new Date(NOW + 12)];
    expect(evaluateLoginBlock({ emailFailures: later, ipFailures: [], now: NOW }).blocked).toBe(true);
    expect(isEmailSuspicious(later, NOW)).toBe(true);
  });
});
