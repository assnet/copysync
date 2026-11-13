import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaPasswordConfirmationRepository } from './PrismaPasswordConfirmationRepository';
import { PrismaUserRepository } from '../../../users/infrastructure/repositories/PrismaUserRepository';
import { ConfirmUserPasswordUseCase } from '../../application/use-cases/ConfirmUserPasswordUseCase';
import { bcryptPasswordVerifier } from '../security/bcryptPasswordVerifier';
import { hashPassword } from '../../../../shared/utils/hash';

/** Contador de confirmação de senha contra o Postgres descartável (docs/seguranca-login.md). */
const stamp = Date.now();
const SECRET = 'Senha-certa-123';
const attempts = new PrismaPasswordConfirmationRepository();
let userId = '';
let otherId = '';
let noHashId = '';

const makeUseCase = (verify = bcryptPasswordVerifier) =>
  new ConfirmUserPasswordUseCase({ users: new PrismaUserRepository(), attempts, verifyPassword: verify });
const codeOf = (r: PromiseSettledResult<void>) => (r.status === 'rejected' ? (r.reason as { code?: string }).code : 'ok');

beforeAll(async () => {
  const passwordHash = await hashPassword(SECRET);
  userId = (await prisma.user.create({ data: { email: `int-pc-${stamp}@x.com`, name: 'Int', passwordHash } })).id;
  otherId = (await prisma.user.create({ data: { email: `int-pc-o-${stamp}@x.com`, name: 'Int', passwordHash } })).id;
  noHashId = (await prisma.user.create({ data: { email: `int-pc-n-${stamp}@x.com`, name: 'Int' } })).id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId, noHashId] } } });
  await prisma.$disconnect();
});

describe('PrismaPasswordConfirmationRepository + ConfirmUserPasswordUseCase', () => {
  it('senha certa grava sucesso; usuário sem hash responde o mesmo 401 e grava falha', async () => {
    await makeUseCase().execute({ userId, password: SECRET, action: 'STOREFRONT_DELETE' });
    expect(await prisma.passwordConfirmationAttempt.findMany({ where: { userId } })).toMatchObject([{ success: true, action: 'STOREFRONT_DELETE' }]);
    await expect(makeUseCase().execute({ userId: noHashId, password: SECRET, action: 'STOREFRONT_DELETE' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
    expect(await prisma.passwordConfirmationAttempt.count({ where: { userId: noHashId, success: false } })).toBe(1);
  });

  it('12 confirmações erradas em paralelo: só 5 chegam ao bcrypt, o resto é 429; outro usuário não é afetado', async () => {
    const verify = vi.fn(bcryptPasswordVerifier);
    const uc = makeUseCase(verify);
    const out = await Promise.allSettled(
      Array.from({ length: 12 }, () => uc.execute({ userId, password: 'errada', action: 'STOREFRONT_DELETE' })),
    );
    const codes = out.map(codeOf);
    expect(codes.filter((c) => c === 'INVALID_CREDENTIALS')).toHaveLength(5);
    expect(codes.filter((c) => c === 'PASSWORD_CONFIRMATION_LOCKED')).toHaveLength(7);
    expect(verify).toHaveBeenCalledTimes(5);
    expect(await prisma.passwordConfirmationAttempt.count({ where: { userId, success: false } })).toBe(5);

    const locked = await uc.execute({ userId, password: SECRET, action: 'STOREFRONT_DELETE' }).catch((e) => e);
    expect(locked).toMatchObject({ code: 'PASSWORD_CONFIRMATION_LOCKED', statusCode: 429 });
    expect(locked.meta.retryAfterSeconds).toBeGreaterThan(880);
    expect(locked.meta.retryAfterSeconds).toBeLessThanOrEqual(900);

    await expect(uc.execute({ userId: otherId, password: SECRET, action: 'STOREFRONT_DELETE' })).resolves.toBeUndefined();
  });

  it('passados 15 min da 5ª falha o usuário volta a confirmar; discard e poda', async () => {
    await prisma.passwordConfirmationAttempt.updateMany({
      where: { userId, success: false }, data: { createdAt: new Date(Date.now() - 16 * 60_000) },
    });
    await expect(makeUseCase().execute({ userId, password: SECRET, action: 'STOREFRONT_DELETE' })).resolves.toBeUndefined();

    const id = await attempts.reserve({ userId: otherId, action: 'STOREFRONT_DELETE', createdAt: new Date() });
    await attempts.discard(id);
    expect(await attempts.failuresSince(otherId, new Date(Date.now() - 60_000))).toHaveLength(0);

    await attempts.pruneUser(userId, new Date(Date.now() - 10 * 60_000));
    expect(await prisma.passwordConfirmationAttempt.count({ where: { userId, success: false } })).toBe(0);
    expect(await prisma.passwordConfirmationAttempt.count({ where: { userId: otherId } })).toBeGreaterThan(0);
  });

  it('apagar o usuário apaga as tentativas (cascade)', async () => {
    await prisma.user.delete({ where: { id: noHashId } });
    expect(await prisma.passwordConfirmationAttempt.count({ where: { userId: noHashId } })).toBe(0);
  });
});
