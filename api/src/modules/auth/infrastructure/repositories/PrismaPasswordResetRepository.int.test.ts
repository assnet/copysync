import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaPasswordResetRepository } from './PrismaPasswordResetRepository';
import { PrismaLoginEventRepository } from './PrismaLoginProtectionRepository';

/** Recuperação de senha contra o Postgres descartável (docs/recuperacao-de-senha.md). */
const stamp = Date.now();
const email = `int-reset-${stamp}@x.com`;
const ip = `198.51.101.${stamp % 200}`;
const repo = new PrismaPasswordResetRepository();
let userId = '';
let tenantId = '';
const at = (offsetMin: number) => new Date(Date.now() + offsetMin * 60_000);

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email, name: 'Int', passwordHash: 'old', mustChangePassword: true } })).id;
});
afterAll(async () => {
  await prisma.passwordResetRequest.deleteMany({ where: { email: { startsWith: 'int-reset-' } } });
  await prisma.loginEvent.deleteMany({ where: { email } });
  await prisma.extensionInstallation.deleteMany({ where: { installationId: `inst-${stamp}` } });
  await prisma.user.deleteMany({ where: { id: userId } });
  if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('PrismaPasswordResetRepository', () => {
  it('contagem por e-mail e IP exclui o próprio pedido; discard tira da conta', async () => {
    const a = await repo.record({ email, ip });
    const b = await repo.record({ email, ip });
    expect(await repo.emailRequestsSince(email, at(-60), b)).toHaveLength(1);
    expect(await repo.ipRequestsSince(ip, at(-60), b)).toHaveLength(1);
    await repo.discard(b);
    expect(await repo.emailRequestsSince(email, at(-60), 'x')).toHaveLength(1);
    await repo.discard(a);
  });

  it('consumo atômico: grava senha, invalida outros links, revoga refresh tokens; 2º uso falha', async () => {
    const [a, b] = [await repo.record({ email, ip }), await repo.record({ email, ip })];
    await repo.attachToken(a, { userId, tokenHash: `ha-${stamp}`, expiresAt: at(60) });
    await repo.attachToken(b, { userId, tokenHash: `hb-${stamp}`, expiresAt: at(60) });
    await prisma.refreshToken.create({ data: { userId, token: `rt-${stamp}`, expiresAt: at(60) } });
    const tenant = await prisma.tenant.create({ data: { name: 'Int reset', slug: `int-reset-${stamp}` } });
    tenantId = tenant.id;
    await prisma.extensionInstallation.create({ data: { installationId: `inst-${stamp}`, extensionId: 'ext', channel: 'chrome', version: '1.0.0' } });
    await prisma.extensionSession.create({ data: { tokenHash: `ext-${stamp}`, userId, installationId: `inst-${stamp}`,
      mlTenantId: tenant.id, extVersion: '1.0.0', expiresAt: at(60), absoluteExpiresAt: at(600) } });
    expect((await repo.findByTokenHash(`ha-${stamp}`))?.userId).toBe(userId);

    const now = new Date();
    const results = await Promise.all([
      repo.consumeAndSetPassword({ id: a, userId, passwordHash: 'new-1', now }),
      repo.consumeAndSetPassword({ id: a, userId, passwordHash: 'new-2', now }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).toBe(results[0] ? 'new-1' : 'new-2');
    expect(user.mustChangePassword).toBe(false);
    expect(user.passwordSetAt).toBeInstanceOf(Date);
    expect((await repo.findByTokenHash(`hb-${stamp}`))?.invalidatedAt).toBeInstanceOf(Date);
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { token: `rt-${stamp}` } })).revokedAt).toBeInstanceOf(Date);
    expect((await prisma.extensionSession.findUniqueOrThrow({ where: { tokenHash: `ext-${stamp}` } })).revokedAt).toBeInstanceOf(Date);
    expect(await repo.consumeAndSetPassword({ id: b, userId, passwordHash: 'x', now })).toBe(false);
  });

  it('dois links diferentes da mesma conta em paralelo: um vence, o outro falha sem deadlock', async () => {
    for (let round = 0; round < 5; round++) {
      const [a, b] = [await repo.record({ email, ip }), await repo.record({ email, ip })];
      await repo.attachToken(a, { userId, tokenHash: `pa-${stamp}-${round}`, expiresAt: at(60) });
      await repo.attachToken(b, { userId, tokenHash: `pb-${stamp}-${round}`, expiresAt: at(60) });
      const now = new Date();
      const results = await Promise.all([
        repo.consumeAndSetPassword({ id: a, userId, passwordHash: 'pa', now }),
        repo.consumeAndSetPassword({ id: b, userId, passwordHash: 'pb', now }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    }
  });

  it('link vencido não consome', async () => {
    const c = await repo.record({ email, ip });
    await repo.attachToken(c, { userId, tokenHash: `hc-${stamp}`, expiresAt: at(-1) });
    expect(await repo.consumeAndSetPassword({ id: c, userId, passwordHash: 'x', now: new Date() })).toBe(false);
  });

  it('PASSWORD_RESET_OK zera a contagem de falhas do login e guarda o userId', async () => {
    const events = new PrismaLoginEventRepository();
    for (let i = 0; i < 3; i++) await events.record({ type: 'LOGIN_FAILED', email, ip, userId: null, userAgent: 'int' });
    expect(await events.emailFailuresSince(email, at(-60), true)).toHaveLength(3);
    await events.record({ type: 'PASSWORD_RESET_OK', email, ip, userId, userAgent: 'int' });
    expect(await events.emailFailuresSince(email, at(-60), true)).toHaveLength(0);
    expect((await prisma.loginEvent.findFirstOrThrow({ where: { email, type: 'PASSWORD_RESET_OK' } })).userId).toBe(userId);
  });

  it('enum de auditoria aceita PASSWORD_RESET_COMPLETED sem tenant', async () => {
    const row = await prisma.auditLog.create({ data: { userId, action: 'PASSWORD_RESET_COMPLETED' } });
    await prisma.auditLog.delete({ where: { id: row.id } });
  });
});
