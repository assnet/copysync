import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

/*
 * Contrato HTTP da proteção do login (docs/seguranca-login.md) em LOGIN_GUARD_MODE=enforce,
 * LOGIN_EMAIL_OTP=on e Turnstile ligado. Fastify de verdade; repositórios e e-mail em memória.
 */
const h = vi.hoisted(() => {
  process.env['LOGIN_GUARD_MODE'] = 'enforce';
  process.env['LOGIN_EMAIL_OTP'] = 'on';
  process.env['TURNSTILE_SECRET_KEY'] = 'test-turnstile-secret';
  return {
    users: [] as { id: string; email: string; name: string; passwordHash: string | null; isSuperAdmin: boolean }[],
    sent: [] as { to: string; template: string; data: Record<string, unknown> }[],
    deliver: true,
  };
});

vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: {} }));
vi.mock('../../../../shared/http/hooks/authHook', () => ({ authHook: async () => {} }));
vi.mock('../../../users/infrastructure/repositories/PrismaUserRepository', () => ({
  PrismaUserRepository: class {
    async findByEmail(e: string) { return h.users.find((u) => u.email === e) ?? null; }
    async findById(id: string) { return h.users.find((u) => u.id === id) ?? null; }
    async findTenantsForUser() { return [{ tenantId: 't1', tenantName: 'Loja', tenantSlug: 'loja', role: 'ADMIN' }]; }
  },
}));
vi.mock('../../infrastructure/repositories/PrismaAuthRepository', () => ({
  PrismaAuthRepository: class { async saveRefreshToken() {} },
}));
vi.mock('../../infrastructure/repositories/PrismaLoginProtectionRepository', async () => {
  const m = await import('../../test/inMemoryLoginProtection');
  return { PrismaLoginEventRepository: m.InMemoryLoginEventRepository, PrismaLoginCodeRepository: m.InMemoryLoginCodeRepository };
});
vi.mock('../../infrastructure/security/CloudflareTurnstileVerifier', () => ({
  CloudflareTurnstileVerifier: class { async verify(token: string) { return { success: token === 'human' }; } },
}));
vi.mock('../../../integrations/infrastructure/email/EmailSenderFactory', () => ({
  createEmailSenderFromEnv: () => ({
    async send(input: { to: string; template: string; data: Record<string, unknown> }) {
      if (!h.deliver) return { sent: false };
      h.sent.push(input);
      return { sent: true };
    },
  }),
}));

import { errorHandler } from '../../../../shared/http/errorHandler';
import { hashPassword } from '../../../../shared/utils/hash';
import { loginStore } from '../../test/inMemoryLoginProtection';
import { authRoutes } from './auth.routes';

const PASS = 'Senha@Forte123';
const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const MIN = 60_000;
let hash = '';
let app: FastifyInstance;

const login = (body: Record<string, unknown>, ip = '203.0.113.7') =>
  app.inject({ method: 'POST', url: '/auth/login', headers: { 'cf-connecting-ip': ip, 'x-forwarded-for': '1.1.1.1' }, payload: { turnstileToken: 'human', ...body } });
const verify = (ticket: string, code: string) => app.inject({ method: 'POST', url: '/auth/login/verify', payload: { ticket, code } });
const resend = (ticket: string) => app.inject({ method: 'POST', url: '/auth/login/resend', payload: { ticket } });
const at = (ms: number) => vi.setSystemTime(new Date(ms));
const wrong = (email = 'ana@x.com') => login({ email, password: 'errada' });
const right = () => login({ email: 'ana@x.com', password: PASS });

/** 3 falhas, bloqueio vence, senha certa → passo do código. */
async function suspiciousLogin() {
  await wrong(); await wrong(); await wrong();
  at(T0 + 61 * MIN);
  const res = await right();
  expect(res.statusCode).toBe(202);
  return res.json().data as { status: string; ticket: string; codeSent: boolean; resendAvailableAt: string };
}

beforeAll(async () => { hash = await hashPassword(PASS); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(T0);
  loginStore.reset();
  h.sent = []; h.deliver = true;
  h.users = [{ id: 'u1', email: 'ana@x.com', name: 'Ana', passwordHash: hash, isSuperAdmin: false }];
  app = Fastify({ trustProxy: 1 });
  await app.register(jwt, { secret: 'x'.repeat(40) });
  app.addSchema({ $id: 'ErrorResponse', type: 'object', properties: { success: { type: 'boolean' },
    error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, meta: { type: 'object', additionalProperties: true } } } } });
  app.addSchema({ $id: 'LoginResponse', type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', additionalProperties: true } } });
  app.setErrorHandler(errorHandler as Parameters<typeof app.setErrorHandler>[0]);
  await app.register(authRoutes, { prefix: '/auth' });
});
afterEach(async () => { await app.close(); vi.useRealTimers(); });

describe('POST /auth/login — erros genéricos e bloqueio', () => {
  it('login limpo: 200 com tokens, sem código e sem e-mail', async () => {
    const res = await right();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.accessToken).toBeTruthy();
    expect(h.sent).toHaveLength(0);
    expect(loginStore.events.at(-1)).toMatchObject({ type: 'LOGIN_OK', userId: 'u1', ip: '203.0.113.7' });
  });

  it('senha errada e e-mail inexistente: mesma resposta 401; falha sem userId; nenhum e-mail', async () => {
    const a = await wrong();
    const b = await wrong('ninguem@x.com');
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
    expect(a.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(loginStore.events.every((e) => e.type === 'LOGIN_FAILED' && e.userId === null)).toBe(true);
    expect(h.sent).toHaveLength(0);
  });

  it('IP vem do cf-connecting-ip, nunca do 1º X-Forwarded-For', async () => {
    await wrong();
    expect(loginStore.events[0].ip).toBe('203.0.113.7');
  });

  it('3ª falha na hora: 429 com retryAt = 1ª falha + 1 h; senha certa também barrada, sem e-mail', async () => {
    await wrong();
    at(T0 + 10 * MIN); await wrong();
    at(T0 + 20 * MIN);
    const third = await wrong();
    expect(third.statusCode).toBe(429);
    expect(third.json().error).toMatchObject({ code: 'LOGIN_TOO_MANY_ATTEMPTS', meta: { retryAt: new Date(T0 + 60 * MIN).toISOString() } });
    expect(Number(third.headers['retry-after'])).toBe(40 * 60);
    const ok = await right();
    expect(ok.statusCode).toBe(429);
    expect(h.sent).toHaveLength(0);
    expect(loginStore.events.filter((e) => e.type === 'LOGIN_FAILED')).toHaveLength(3);
  });

  it('10 falhas do mesmo IP com e-mails diferentes: 429', async () => {
    for (let i = 0; i < 9; i++) expect((await wrong(`u${i}@x.com`)).statusCode).toBe(401);
    expect((await wrong('u9@x.com')).statusCode).toBe(429);
    expect((await login({ email: 'ana@x.com', password: PASS })).statusCode).toBe(429);
    expect((await login({ email: 'ana@x.com', password: PASS }, '198.51.100.1')).statusCode).toBe(200);
  });

  it('Turnstile ausente/ inválido: 403 antes da senha (não conta falha)', async () => {
    const none = await login({ email: 'ana@x.com', password: PASS, turnstileToken: undefined });
    expect(none.json().error.code).toBe('LOGIN_CAPTCHA_REQUIRED');
    const bad = await login({ email: 'ana@x.com', password: 'errada', turnstileToken: 'bot' });
    expect(bad.statusCode).toBe(403);
    expect(bad.json().error.code).toBe('LOGIN_CAPTCHA_INVALID');
    expect(loginStore.events).toHaveLength(0);
  });
});

describe('código por e-mail no login suspeito', () => {
  it('só depois da senha certa: 202 OTP_REQUIRED, e-mail LOGIN_VERIFICATION, código fora da resposta', async () => {
    await wrong(); await wrong(); await wrong();
    expect(h.sent).toHaveLength(0);
    at(T0 + 61 * MIN);
    expect((await wrong()).statusCode).toBe(401);
    expect(h.sent).toHaveLength(0);
    const res = await right();
    expect(res.statusCode).toBe(202);
    const data = res.json().data;
    expect(data).toMatchObject({ status: 'OTP_REQUIRED', codeSent: true });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ to: 'ana@x.com', template: 'LOGIN_VERIFICATION', data: { expiresInMinutes: 10, name: 'Ana' } });
    const code = h.sent[0].data.code as string;
    expect(code).toMatch(/^\d{6}$/);
    expect(res.body).not.toContain(code);
    expect(loginStore.codes[0].codeHash).not.toContain(code);
  });

  it('verify: código errado 400 com tentativas restantes; certo → tokens e contagem zerada', async () => {
    const { ticket } = await suspiciousLogin();
    const code = h.sent[0].data.code as string;
    const bad = await verify(ticket, code === '000000' ? '111111' : '000000');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatchObject({ code: 'LOGIN_CODE_INVALID', meta: { attemptsLeft: 4 } });
    const ok = await verify(ticket, code);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.refreshToken).toBeTruthy();
    expect((await verify(ticket, code)).json().error.code).toBe('LOGIN_CODE_EXPIRED');
    const next = await right();
    expect(next.statusCode).toBe(200);
    expect(h.sent).toHaveLength(1);
  });

  it('5 tentativas erradas invalidam o código', async () => {
    const { ticket } = await suspiciousLogin();
    const code = h.sent[0].data.code as string;
    const other = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) expect((await verify(ticket, other)).json().error.code).toBe('LOGIN_CODE_INVALID');
    expect((await verify(ticket, other)).json().error.code).toBe('LOGIN_CODE_EXHAUSTED');
    expect((await verify(ticket, code)).json().error.code).toBe('LOGIN_CODE_EXHAUSTED');
  });

  it('ticket adulterado ou vencido: 400 LOGIN_TICKET_INVALID', async () => {
    const { ticket } = await suspiciousLogin();
    expect((await verify(`${ticket}x`, '123456')).json().error.code).toBe('LOGIN_TICKET_INVALID');
    at(T0 + 72 * MIN);
    expect((await verify(ticket, h.sent[0].data.code as string)).json().error.code).toBe('LOGIN_TICKET_INVALID');
  });

  it('reenvio: intervalo mínimo, depois teto de 3 por hora com retryAt', async () => {
    const first = await suspiciousLogin();
    const early = await resend(first.ticket);
    expect(early.statusCode).toBe(429);
    expect(early.json().error).toMatchObject({ code: 'LOGIN_CODE_SEND_LIMIT', meta: { retryAt: first.resendAvailableAt } });
    at(T0 + 62 * MIN);
    const second = await resend(first.ticket);
    expect(second.statusCode).toBe(202);
    at(T0 + 63 * MIN);
    expect((await resend(second.json().data.ticket)).statusCode).toBe(202);
    expect(h.sent).toHaveLength(3);
    at(T0 + 64 * MIN);
    const capped = await resend(second.json().data.ticket);
    expect(capped.json().error).toMatchObject({ code: 'LOGIN_CODE_SEND_LIMIT', meta: { retryAt: new Date(T0 + 121 * MIN).toISOString() } });
    // só o último código vale
    expect((await verify(second.json().data.ticket, h.sent[0].data.code as string)).statusCode).toBe(400);
    expect((await verify(second.json().data.ticket, h.sent[2].data.code as string)).statusCode).toBe(200);
  });

  it('novo login logo após o envio reaproveita o código aberto (sem novo e-mail)', async () => {
    await suspiciousLogin();
    const again = await right();
    expect(again.statusCode).toBe(202);
    expect(again.json().data.codeSent).toBe(false);
    expect(h.sent).toHaveLength(1);
  });

  it('falha no envio: 503 LOGIN_CODE_DELIVERY_FAILED sem consumir o teto', async () => {
    await wrong(); await wrong(); await wrong();
    at(T0 + 61 * MIN);
    h.deliver = false;
    const res = await right();
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('LOGIN_CODE_DELIVERY_FAILED');
    expect(loginStore.codes).toHaveLength(0);
    h.deliver = true;
    expect((await right()).statusCode).toBe(202);
  });
});
