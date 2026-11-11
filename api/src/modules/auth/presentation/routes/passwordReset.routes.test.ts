import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../../../../shared/http/errorHandler';
import { hashInviteToken } from '../../../../shared/utils/generateInviteToken';
import { verifyPassword } from '../../../../shared/utils/hash';
import { User } from '../../../users/domain/entities/User';
import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import type { IPasswordResetRepository, PasswordResetRecord } from '../../domain/contracts/IPasswordResetRepository';
import type { SendEmailInput } from '../../../integrations/domain/contracts/IEmailSender';
import { RequestPasswordResetUseCase } from '../../application/use-cases/RequestPasswordResetUseCase';
import { ResetPasswordUseCase } from '../../application/use-cases/ResetPasswordUseCase';
import { LoginCaptchaRequiredError } from '../../../../shared/errors/internal/AuthErrors';
import { passwordResetRoutes } from './passwordReset.routes';

/*
 * Contrato HTTP da recuperação de senha: Fastify de verdade, repositórios em memória.
 * Doc: docs/recuperacao-de-senha.md.
 */
vi.mock('../../../../shared/http/clientIp', () => ({
  resolveClientIp: (r: { headers: Record<string, string> }) => r.headers['x-test-ip'] ?? '10.0.0.1',
}));

type Row = PasswordResetRecord & { ip: string | null; tokenHash: string | null; createdAt: Date };
const PASS = 'Senha@Forte123';

let rows: Row[];
let users: User[];
let sent: SendEmailInput[];
let revoked: string[];
let events: { type: string; email: string; userId: string }[];
let audits: unknown[];
let requireCaptcha: boolean;
let app: FastifyInstance;

const user = (id: string, email: string, passwordHash: string | null = 'old-hash'): User => {
  const now = new Date();
  return new User({ id, email, passwordHash, passwordSetAt: passwordHash ? now : null, mustChangePassword: true,
    name: 'Ana', isSuperAdmin: false, createdAt: now, updatedAt: now });
};

const resets: IPasswordResetRepository = {
  async record(i) { const id = `r${rows.length + 1}`; rows.push({ id, ...i, userId: null, tokenHash: null, expiresAt: null, usedAt: null, invalidatedAt: null, createdAt: new Date() }); return id; },
  async discard(id) { rows = rows.filter((r) => r.id !== id); },
  async emailRequestsSince(email, since, ex) { return rows.filter((r) => r.email === email && r.id !== ex && r.createdAt >= since).map((r) => r.createdAt); },
  async ipRequestsSince(ip, since, ex) { return rows.filter((r) => r.ip === ip && r.id !== ex && r.createdAt >= since).map((r) => r.createdAt); },
  async attachToken(id, i) { Object.assign(rows.find((r) => r.id === id)!, i); },
  async findByTokenHash(h) { return rows.find((r) => r.tokenHash === h) ?? null; },
  async consumeAndSetPassword({ id, userId, passwordHash, now }) {
    const row = rows.find((r) => r.id === id)!;
    if (row.usedAt || row.invalidatedAt || !row.expiresAt || row.expiresAt <= now) return false;
    row.usedAt = now;
    const u = users.find((x) => x.id === userId)!;
    users = users.map((x) => (x.id === userId ? new User({ id: u.id, email: u.email, passwordHash, passwordSetAt: now,
      mustChangePassword: false, name: u.name, isSuperAdmin: u.isSuperAdmin, createdAt: u.createdAt, updatedAt: now }) : x));
    rows.filter((r) => r.userId === userId && r.id !== id && !r.usedAt).forEach((r) => { r.invalidatedAt = now; });
    revoked.push(userId);
    return true;
  },
  async prune() {},
};
const userRepo = {
  async findByEmail(e: string) { return users.find((u) => u.email === e) ?? null; },
  async findById(id: string) { return users.find((u) => u.id === id) ?? null; },
} as unknown as IUserRepository;
const guard = {
  async assertHuman(token: string | undefined) { if (requireCaptcha && !token) throw new LoginCaptchaRequiredError(); },
  async recordSuccess(type: string, email: string, userId: string) { events.push({ type, email, userId }); },
};

beforeEach(async () => {
  rows = []; users = [user('u1', 'ana@x.com')]; sent = []; revoked = []; events = []; audits = []; requireCaptcha = false;
  const emailSender = { async send(i: SendEmailInput) { sent.push(i); return { sent: true }; } };
  app = Fastify();
  app.addSchema({ $id: 'ErrorResponse', type: 'object', properties: { success: { type: 'boolean' },
    error: { type: 'object', additionalProperties: true, properties: { code: { type: 'string' }, message: { type: 'string' } } } } });
  app.setErrorHandler(errorHandler as Parameters<typeof app.setErrorHandler>[0]);
  await app.register(passwordResetRoutes, {
    prefix: '/auth',
    requestPasswordReset: new RequestPasswordResetUseCase(userRepo, resets, guard, emailSender, 'https://painel.test', () => 'ref', () => 1),
    resetPassword: new ResetPasswordUseCase(userRepo, resets, guard, { async create(a) { audits.push(a); } }),
  });
});
afterEach(async () => { await app.close(); });

/** A entrega (busca da conta, token, e-mail) roda depois da resposta: espera a fila esvaziar. */
const forgot = async (email: string, extra: object = {}, ip = '10.0.0.1') => {
  const res = await app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { email, ...extra }, headers: { 'x-test-ip': ip } });
  await new Promise((r) => setImmediate(r));
  return res;
};
const info = (t: string) => app.inject({ method: 'POST', url: '/auth/password/reset/inspect', payload: { token: t } });
const reset = (t: string, body: object = { password: PASS, confirmPassword: PASS }) =>
  app.inject({ method: 'POST', url: '/auth/password/reset', payload: { token: t, ...body } });
const tokenFromEmail = (i = 0) => String(sent[i].data.link).split('/reset-password/')[1];

describe('recuperação de senha', () => {
  it('conta existente e inexistente: mesma resposta 202; e-mail só para a existente', async () => {
    const a = await forgot('Ana@X.com ');
    const b = await forgot('ninguem@x.com');
    expect(a.statusCode).toBe(400); // e-mail com espaço não passa no schema
    const c = await forgot('ANA@x.com');
    expect([b.statusCode, c.statusCode]).toEqual([202, 202]);
    expect(b.json()).toEqual(c.json());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'ana@x.com', template: 'RESET_PASSWORD' });
    expect(String(sent[0].data.link)).toMatch(/^https:\/\/painel\.test\/reset-password\/[\w-]{43}$/);
  });

  it('a resposta não espera busca da conta, token nem e-mail (tempo igual com ou sem conta)', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const original = userRepo.findByEmail;
    userRepo.findByEmail = async (e: string) => { await gate; return original(e); };
    try {
      const res = await app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { email: 'ana@x.com' } });
      expect(res.statusCode).toBe(202);
      expect(sent).toHaveLength(0);
      release();
      await new Promise((r) => setImmediate(r));
      expect(sent).toHaveLength(1);
    } finally { userRepo.findByEmail = original; }
  });

  it('só o hash do token vai para o banco', async () => {
    await forgot('ana@x.com');
    const token = tokenFromEmail();
    expect(rows[0].tokenHash).toBe(hashInviteToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('4º pedido do mesmo e-mail na hora: 429 com retryAt, mesmo para conta inexistente', async () => {
    for (const email of ['ana@x.com', 'ninguem@x.com']) {
      for (let i = 0; i < 3; i++) expect((await forgot(email, {}, `10.0.1.${i}${email.length}`)).statusCode).toBe(202);
      const res = await forgot(email, {}, '10.0.2.9');
      expect(res.statusCode).toBe(429);
      expect(res.json().error.code).toBe('PASSWORD_RESET_TOO_MANY_REQUESTS');
      expect(rows.filter((r) => r.email === email)).toHaveLength(3);
    }
  });

  it('11º pedido do mesmo IP: 429', async () => {
    for (let i = 0; i < 10; i++) expect((await forgot(`p${i}@x.com`)).statusCode).toBe(202);
    expect((await forgot('p10@x.com')).statusCode).toBe(429);
  });

  it('Turnstile exigido e ausente: 403, nada gravado', async () => {
    requireCaptcha = true;
    const res = await forgot('ana@x.com');
    expect(res.statusCode).toBe(403);
    expect(rows).toHaveLength(0);
    expect((await forgot('ana@x.com', { turnstileToken: 'ok' })).statusCode).toBe(202);
  });

  it('link válido: mostra o e-mail; redefinir grava a senha, encerra sessões e é de uso único', async () => {
    await forgot('ana@x.com');
    await forgot('ana@x.com');
    const [t1, t2] = [tokenFromEmail(0), tokenFromEmail(1)];
    const i = await info(t1);
    expect(i.statusCode).toBe(200);
    expect(i.json().data.email).toBe('ana@x.com');

    const res = await reset(t1);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ status: 'RESET' });
    const u = users[0];
    expect(await verifyPassword(PASS, u.passwordHash!)).toBe(true);
    expect(u.mustChangePassword).toBe(false);
    expect(revoked).toEqual(['u1']);
    expect(events).toEqual([{ type: 'PASSWORD_RESET_OK', email: 'ana@x.com', userId: 'u1' }]);
    expect(audits).toHaveLength(1);

    // usado e o outro link aberto da conta: ambos inválidos
    for (const t of [t1, t2]) {
      expect((await info(t)).statusCode).toBe(404);
      const again = await reset(t);
      expect(again.statusCode).toBe(404);
      expect(again.json().error.code).toBe('PASSWORD_RESET_INVALID');
    }
  });

  it('conta sem senha (convite vencido) também redefine', async () => {
    users = [user('u1', 'ana@x.com', null)];
    await forgot('ana@x.com');
    expect((await reset(tokenFromEmail())).statusCode).toBe(200);
    expect(users[0].hasPassword()).toBe(true);
  });

  it('link vencido ou inexistente: 404', async () => {
    await forgot('ana@x.com');
    rows[0].expiresAt = new Date(Date.now() - 1);
    for (const t of [tokenFromEmail(), 'nao-existe']) {
      expect((await info(t)).statusCode).toBe(404);
      expect((await reset(t)).statusCode).toBe(404);
    }
    expect(users[0].passwordHash).toBe('old-hash');
  });

  it('senha fraca ou diferente: 400, link continua válido', async () => {
    await forgot('ana@x.com');
    const t = tokenFromEmail();
    expect((await reset(t, { password: 'fraquinha1', confirmPassword: 'fraquinha1' })).statusCode).toBe(400);
    expect((await reset(t, { password: PASS, confirmPassword: `${PASS}x` })).statusCode).toBe(400);
    expect((await info(t)).statusCode).toBe(200);
  });
});
