import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../../../shared/utils/hash';
import { resolveLoginGuardPolicy, type LoginGuardMode } from '../../domain/services/loginGuardRules';
import { HmacLoginCodeHasher, HmacLoginTicketSigner } from '../../infrastructure/security/HmacLoginSecurity';
import { InMemoryLoginCodeRepository, InMemoryLoginEventRepository, loginStore } from '../../test/inMemoryLoginProtection';
import { LoginCodeChallenge } from '../services/LoginCodeChallenge';
import { LoginGuard } from '../services/LoginGuard';
import { LoginUseCase } from './LoginUseCase';
import type { CreateLoginSessionUseCase } from './CreateLoginSessionUseCase';
import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';

/** Modos off / monitor e flag do código (docs/seguranca-login.md, tabela modo × comportamento). */
const PASS = 'Senha@Forte123';
let hash = '';
let sent = 0;
let now = Date.UTC(2026, 10, 7, 12);
const ctx = { ip: '203.0.113.7', userAgent: 'vitest' };

function build(mode: LoginGuardMode, otp: boolean) {
  const users = { findByEmail: async (e: string) => (e === 'ana@x.com' ? { id: 'u1', email: e, name: 'Ana', passwordHash: hash, isSuperAdmin: false } : null) } as unknown as IUserRepository;
  const policy = resolveLoginGuardPolicy({ LOGIN_GUARD_MODE: mode, LOGIN_EMAIL_OTP: otp, TURNSTILE_SECRET_KEY: 'secret' });
  const guard = new LoginGuard(new InMemoryLoginEventRepository(), { verify: async () => ({ success: false }) }, policy, () => 1);
  const challenge = new LoginCodeChallenge(new InMemoryLoginCodeRepository(), new HmacLoginCodeHasher('k'.repeat(40)), new HmacLoginTicketSigner('k'.repeat(40)),
    { send: async () => { sent++; return { sent: true }; } });
  const session = { execute: async () => ({ userId: 'u1' }) } as unknown as CreateLoginSessionUseCase;
  return new LoginUseCase(users, guard, challenge, session, () => now);
}

const attempt = (uc: LoginUseCase, password: string) => uc.execute({ email: 'ana@x.com', password }, ctx).then((r) => r.kind, (e: { code: string }) => e.code);

beforeAll(async () => { hash = await hashPassword(PASS); });
beforeEach(() => { loginStore.reset(); loginStore.clock = () => now; sent = 0; now = Date.UTC(2026, 10, 7, 12); });

describe('LoginUseCase por modo', () => {
  it('off: sem eventos, sem bloqueio, sem Turnstile (comportamento antigo)', async () => {
    const uc = build('off', true);
    for (let i = 0; i < 5; i++) expect(await attempt(uc, 'x')).toBe('INVALID_CREDENTIALS');
    expect(await attempt(uc, PASS)).toBe('SESSION');
    expect(loginStore.events).toHaveLength(0);
  });

  it('monitor: grava e bloqueia (429), mas não pede Turnstile nem código', async () => {
    const uc = build('monitor', true);
    await attempt(uc, 'x'); await attempt(uc, 'x');
    expect(await attempt(uc, 'x')).toBe('LOGIN_TOO_MANY_ATTEMPTS');
    expect(await attempt(uc, PASS)).toBe('LOGIN_TOO_MANY_ATTEMPTS');
    now += 61 * 60_000;
    expect(await attempt(uc, PASS)).toBe('SESSION');
    expect(sent).toBe(0);
  });

  it('enforce com LOGIN_EMAIL_OTP=off: Turnstile exigido, sem código', async () => {
    const uc = build('enforce', false);
    expect(await attempt(uc, PASS)).toBe('LOGIN_CAPTCHA_REQUIRED');
  });

  it('LoginGuard não derruba o login quando o banco falha', async () => {
    const policy = resolveLoginGuardPolicy({ LOGIN_GUARD_MODE: 'monitor', LOGIN_EMAIL_OTP: false });
    const broken = { record: async () => { throw new Error('db'); }, emailFailuresSince: async () => { throw new Error('db'); }, ipFailuresSince: async () => [], prune: async () => {} };
    const guard = new LoginGuard(broken, null, policy);
    await expect(guard.assertAllowed('ana@x.com', ctx, now)).resolves.toBeUndefined();
    await expect(guard.recordFailure('ana@x.com', ctx, now)).resolves.toBeUndefined();
  });
});
