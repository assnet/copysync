import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '../../../../shared/utils/hash';
import { resolveLoginGuardPolicy, type LoginGuardMode } from '../../domain/services/loginGuardRules';
import type { PasswordVerifier } from '../../domain/contracts/ILoginSecurity';
import { HmacLoginCodeHasher, HmacLoginTicketSigner } from '../../infrastructure/security/HmacLoginSecurity';
import { bcryptPasswordVerifier } from '../../infrastructure/security/bcryptPasswordVerifier';
import { InMemoryLoginCodeRepository, InMemoryLoginEventRepository, loginStore } from '../../test/inMemoryLoginProtection';
import { LoginCodeChallenge } from '../services/LoginCodeChallenge';
import { LoginGuard } from '../services/LoginGuard';
import { LoginUseCase } from './LoginUseCase';
import type { CreateLoginSessionUseCase } from './CreateLoginSessionUseCase';
import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';

/** Modos off / monitor / enforce, corrida de tentativas e tempo constante (docs/seguranca-login.md). */
const PASS = 'Senha@Forte123';
let hash = '';
let sent = 0;
let now = Date.UTC(2026, 10, 7, 12);
const ctx = { ip: '203.0.113.7', userAgent: 'vitest' };
const KEYS = { TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_SITE_KEY: 'site' };

function build(mode: LoginGuardMode, otp: boolean, verifier: PasswordVerifier = (p, h) => (h ? verifyPassword(p, h) : Promise.resolve(false)), keys = KEYS) {
  const users = { findByEmail: async (e: string) => (e === 'ana@x.com' ? { id: 'u1', email: e, name: 'Ana', passwordHash: hash, isSuperAdmin: false } : null) } as unknown as IUserRepository;
  const policy = resolveLoginGuardPolicy({ LOGIN_GUARD_MODE: mode, LOGIN_EMAIL_OTP: otp, ...keys });
  const guard = new LoginGuard(new InMemoryLoginEventRepository(), { verify: async () => ({ success: false }) }, policy, (e) => `ref:${e.length}`, () => 1);
  const challenge = new LoginCodeChallenge(new InMemoryLoginCodeRepository(), new HmacLoginCodeHasher('k'.repeat(40)), new HmacLoginTicketSigner('k'.repeat(40)),
    { send: async () => { sent++; return { sent: true }; } });
  const session = { execute: async () => ({ userId: 'u1' }) } as unknown as CreateLoginSessionUseCase;
  return new LoginUseCase(users, guard, challenge, session, verifier, () => now);
}

const attempt = (uc: LoginUseCase, password: string, email = 'ana@x.com', ip = ctx.ip) =>
  uc.execute({ email, password }, { ...ctx, ip }).then((r) => r.kind, (e: { code: string }) => e.code);

beforeAll(async () => { hash = await hashPassword(PASS); });
beforeEach(() => { loginStore.reset(); loginStore.clock = () => now; sent = 0; now = Date.UTC(2026, 10, 7, 12); });

describe('LoginUseCase por modo', () => {
  it('off: sem eventos, sem bloqueio, sem Turnstile (comportamento antigo)', async () => {
    const uc = build('off', true);
    for (let i = 0; i < 5; i++) expect(await attempt(uc, 'x')).toBe('INVALID_CREDENTIALS');
    expect(await attempt(uc, PASS)).toBe('SESSION');
    expect(loginStore.events).toHaveLength(0);
  });

  it('monitor: grava e bloqueia (429), mas não pede Turnstile nem código; sem tentativa pendurada', async () => {
    const uc = build('monitor', true);
    await attempt(uc, 'x'); await attempt(uc, 'x');
    expect(await attempt(uc, 'x')).toBe('LOGIN_TOO_MANY_ATTEMPTS');
    expect(await attempt(uc, PASS)).toBe('LOGIN_TOO_MANY_ATTEMPTS');
    now += 61 * 60_000;
    expect(await attempt(uc, PASS)).toBe('SESSION');
    expect(sent).toBe(0);
    expect(loginStore.events.some((e) => e.type === 'LOGIN_ATTEMPT')).toBe(false);
  });

  it('enforce: Turnstile exigido só com site key + secret', async () => {
    expect(await attempt(build('enforce', false), PASS)).toBe('LOGIN_CAPTCHA_REQUIRED');
    expect(await attempt(build('enforce', false, undefined, { TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_SITE_KEY: '' }), PASS)).toBe('SESSION');
  });

  it('LoginGuard não derruba o login quando o banco falha', async () => {
    const policy = resolveLoginGuardPolicy({ LOGIN_GUARD_MODE: 'monitor', LOGIN_EMAIL_OTP: false });
    const boom = async () => { throw new Error('db'); };
    const broken = { record: boom, markAttemptFailed: boom, discardAttempt: boom, emailFailuresSince: boom, ipFailuresSince: boom, prune: async () => {} };
    const guard = new LoginGuard(broken, null, policy, (e) => e);
    await expect(guard.begin('ana@x.com', ctx, now)).resolves.toBeNull();
  });
});

describe('corrida e tempo', () => {
  it('10 logins paralelos com senha errada: no máximo 3 conferências de senha', async () => {
    let checks = 0;
    const slow: PasswordVerifier = async () => { checks++; await new Promise((r) => setTimeout(r, 5)); return false; };
    const uc = build('monitor', false, slow);
    const results = await Promise.all(Array.from({ length: 10 }, () => attempt(uc, 'x')));
    expect(checks).toBeLessThanOrEqual(3);
    expect(results.filter((r) => r === 'LOGIN_TOO_MANY_ATTEMPTS').length).toBeGreaterThanOrEqual(7);
    expect(loginStore.events.filter((e) => e.type === 'LOGIN_FAILED').length).toBeLessThanOrEqual(3);
  });

  it('15 logins paralelos do mesmo IP com e-mails diferentes: no máximo 10 conferências', async () => {
    let checks = 0;
    const slow: PasswordVerifier = async () => { checks++; await new Promise((r) => setTimeout(r, 5)); return false; };
    const uc = build('monitor', false, slow);
    await Promise.all(Array.from({ length: 15 }, (_, i) => attempt(uc, 'x', `u${i}@x.com`)));
    expect(checks).toBeLessThanOrEqual(10);
  });

  it('usuário inexistente também paga o bcrypt (hash fixo de mesmo custo)', async () => {
    const spy = vi.fn(bcryptPasswordVerifier);
    const uc = build('monitor', false, spy);
    expect(await attempt(uc, 'x', 'ninguem@x.com')).toBe('INVALID_CREDENTIALS');
    expect(spy).toHaveBeenCalledWith('x', null);
    await expect(bcryptPasswordVerifier(PASS, null)).resolves.toBe(false);
  });
});
