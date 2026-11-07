import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaLoginCodeRepository, PrismaLoginEventRepository } from './PrismaLoginProtectionRepository';
import { evaluateLoginBlock, isEmailSuspicious, resolveLoginGuardPolicy } from '../../domain/services/loginGuardRules';
import type { PasswordVerifier } from '../../domain/contracts/ILoginSecurity';
import { LoginGuard } from '../../application/services/LoginGuard';
import { LoginCodeChallenge } from '../../application/services/LoginCodeChallenge';
import { LoginUseCase } from '../../application/use-cases/LoginUseCase';
import type { CreateLoginSessionUseCase } from '../../application/use-cases/CreateLoginSessionUseCase';
import type { IUserRepository } from '../../../users/domain/contracts/IUserRepository';
import { HmacLoginCodeHasher, HmacLoginTicketSigner } from '../security/HmacLoginSecurity';

/** Repositórios da proteção do login contra o Postgres descartável (docs/seguranca-login.md). */
const stamp = Date.now();
const email = `int-login-${stamp}@x.com`;
const ip = `198.51.100.${stamp % 200}`;
const events = new PrismaLoginEventRepository();
const codes = new PrismaLoginCodeRepository();
let userId = '';
const min = 60_000;
const at = (offsetMin: number) => new Date(Date.now() + offsetMin * min);

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email, name: 'Int' } })).id;
});
afterAll(async () => {
  await prisma.loginEvent.deleteMany({ where: { email: { startsWith: 'int-' } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('PrismaLoginEventRepository', () => {
  it('falha grava sem userId; contagem por e-mail e por IP na janela', async () => {
    for (let i = 0; i < 3; i++) await events.record({ type: 'LOGIN_FAILED', email, ip, userId: 'u-x', userAgent: 'int' });
    const pending = await events.record({ type: 'LOGIN_ATTEMPT', email, ip, userId: null, userAgent: 'int' });
    expect(await events.emailFailuresSince(email, at(-60), true, { includePending: true })).toHaveLength(4);
    expect(await events.emailFailuresSince(email, at(-60), true, { includePending: true, excludeId: pending })).toHaveLength(3);
    await events.discardAttempt(pending);
    const rows = await prisma.loginEvent.findMany({ where: { email } });
    expect(rows.every((r) => r.userId === null)).toBe(true);
    const since = at(-60);
    const byEmail = await events.emailFailuresSince(email, since, true);
    const byIp = await events.ipFailuresSince(ip, since);
    expect(byEmail).toHaveLength(3);
    expect(byIp).toHaveLength(3);
    const d = evaluateLoginBlock({ emailFailures: byEmail, ipFailures: byIp, now: Date.now() });
    expect(d.blocked).toBe(true);
    expect(isEmailSuspicious(byEmail, Date.now())).toBe(true);
  });

  it('LOGIN_CODE_VERIFIED zera a contagem do e-mail (não a do IP)', async () => {
    await events.record({ type: 'LOGIN_CODE_VERIFIED', email, ip, userId, userAgent: null });
    expect(await events.emailFailuresSince(email, at(-60), true)).toHaveLength(0);
    expect(await events.emailFailuresSince(email, at(-60), false)).toHaveLength(3);
    expect(await events.ipFailuresSince(ip, at(-60))).toHaveLength(3);
  });

  it('poda apaga só o que passou do corte', async () => {
    await prisma.loginEvent.create({ data: { type: 'LOGIN_FAILED', email, ip, createdAt: at(-60 * 24 * 40) } });
    await events.prune(at(-60 * 24 * 30), at(-60 * 24));
    expect(await prisma.loginEvent.count({ where: { email } })).toBe(4);
  });
});

describe('PrismaLoginCodeRepository', () => {
  it('pendente conta no teto; falha de envio apaga; enviado invalida os anteriores', async () => {
    const a = await codes.createPending({ userId, codeHash: 'h-a', expiresAt: at(10) });
    expect(await codes.createdSince(userId, at(-60))).toHaveLength(1);
    expect(await codes.findLatestOpen(userId)).toBeNull();
    await codes.deletePending(a.id);
    expect(await codes.createdSince(userId, at(-60))).toHaveLength(0);

    const b = await codes.createPending({ userId, codeHash: 'h-b', expiresAt: at(10) });
    await codes.markSent(b.id, userId, new Date());
    const c = await codes.createPending({ userId, codeHash: 'h-c', expiresAt: at(10) });
    await codes.markSent(c.id, userId, new Date(Date.now() + 1000));
    expect((await codes.findLatestOpen(userId))?.id).toBe(c.id);
    expect((await prisma.loginCode.findUniqueOrThrow({ where: { id: b.id } })).invalidatedAt).not.toBeNull();
  });

  it('tentativas atômicas até o teto; consumo único', async () => {
    const open = (await codes.findLatestOpen(userId))!;
    const results = await Promise.all(Array.from({ length: 7 }, () => codes.registerAttempt(open.id, 5)));
    expect(results.filter((r) => r !== null).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(results.filter((r) => r === null)).toHaveLength(2);
    const [x, y] = await Promise.all([codes.consume(open.id, new Date()), codes.consume(open.id, new Date())]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    expect(await codes.findLatestOpen(userId)).toBeNull();
  });

  it('código apaga em cascata com o usuário', async () => {
    const u = await prisma.user.create({ data: { email: `int-login-casc-${stamp}@x.com`, name: 'C' } });
    await codes.createPending({ userId: u.id, codeHash: 'h', expiresAt: at(10) });
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.loginCode.count({ where: { userId: u.id } })).toBe(0);
  });
});

describe('corrida (Postgres real)', () => {
  const policy = resolveLoginGuardPolicy({ LOGIN_GUARD_MODE: 'monitor', LOGIN_EMAIL_OTP: false });
  const build = (verifier: PasswordVerifier) => new LoginUseCase(
    { findByEmail: async () => null } as unknown as IUserRepository,
    new LoginGuard(events, null, policy, (e) => e, () => 1),
    {} as LoginCodeChallenge,
    {} as CreateLoginSessionUseCase,
    verifier,
  );

  it('10 logins paralelos do mesmo e-mail: no máximo 3 conferências de senha e 3 falhas', async () => {
    const target = `int-race-${stamp}@x.com`;
    let checks = 0;
    const uc = build(async () => { checks++; await new Promise((r) => setTimeout(r, 20)); return false; });
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      uc.execute({ email: target, password: 'x' }, { ip: `192.0.2.${i}`, userAgent: null }).catch((e: { code: string }) => e.code)));
    expect(checks).toBeLessThanOrEqual(3);
    expect(res.filter((r) => r === 'LOGIN_TOO_MANY_ATTEMPTS').length).toBeGreaterThanOrEqual(7);
    expect(await prisma.loginEvent.count({ where: { email: target, type: 'LOGIN_FAILED' } })).toBeLessThanOrEqual(3);
    expect(await prisma.loginEvent.count({ where: { email: target, type: 'LOGIN_ATTEMPT' } })).toBe(0);
  });

  it('15 logins paralelos do mesmo IP: no máximo 10 conferências', async () => {
    const raceIp = `198.18.0.${stamp % 200}`;
    let checks = 0;
    const uc = build(async () => { checks++; await new Promise((r) => setTimeout(r, 20)); return false; });
    await Promise.all(Array.from({ length: 15 }, (_, i) =>
      uc.execute({ email: `int-ip-${stamp}-${i}@x.com`, password: 'x' }, { ip: raceIp, userAgent: null }).catch(() => null)));
    expect(checks).toBeLessThanOrEqual(10);
  });

  it('envio de código em paralelo: advisory lock deixa 1 envio (intervalo de 60 s)', async () => {
    let sends = 0;
    const challenge = new LoginCodeChallenge(codes, new HmacLoginCodeHasher('k'.repeat(40)), new HmacLoginTicketSigner('k'.repeat(40)),
      { send: async () => { sends++; await new Promise((r) => setTimeout(r, 20)); return { sent: true }; } });
    await prisma.loginCode.deleteMany({ where: { userId } });
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => challenge.start({ id: userId, email, name: 'Int' }, Date.now(), { allowReuse: false })));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(sends).toBe(1);
    expect(await prisma.loginCode.count({ where: { userId } })).toBe(1);
  });
});
