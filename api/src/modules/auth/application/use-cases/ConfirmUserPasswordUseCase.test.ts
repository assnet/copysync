import { describe, expect, it, vi } from 'vitest';
import { ConfirmUserPasswordUseCase } from './ConfirmUserPasswordUseCase';
import { InMemoryPasswordConfirmationRepository } from '../../test/inMemoryPasswordConfirmation';
import type { User } from '../../../users/domain/entities/User';

const USER = 'user-1';
const T0 = new Date('2026-11-13T12:00:00.000Z').getTime();
const SECRET = 'S3nh@-muito-secreta';

function setup(over: { hash?: string | null; exists?: boolean } = {}) {
  const attempts = new InMemoryPasswordConfirmationRepository();
  const clock = { ms: T0 };
  const order: string[] = [];
  const reserve = attempts.reserve.bind(attempts);
  attempts.reserve = async (input) => { order.push('reserve'); return reserve(input); };
  const findById = vi.fn(async () => (over.exists === false ? null : ({ id: USER, passwordHash: over.hash === undefined ? 'hash' : over.hash } as User)));
  const verifyPassword = vi.fn(async (plain: string, hash: string | null) => { order.push('verify'); return hash === 'hash' && plain === SECRET; });
  const uc = new ConfirmUserPasswordUseCase({ users: { findById }, attempts, verifyPassword, now: () => new Date(clock.ms) });
  const run = (password: string, userId = USER) => uc.execute({ userId, password, action: 'STOREFRONT_DELETE' });
  return { uc, attempts, clock, order, findById, verifyPassword, run };
}

describe('ConfirmUserPasswordUseCase', () => {
  it('senha certa: reserva antes do bcrypt e a tentativa vira sucesso', async () => {
    const s = setup();
    await expect(s.run(SECRET)).resolves.toBeUndefined();
    expect(s.order).toEqual(['reserve', 'verify']);
    expect(s.attempts.rows).toMatchObject([{ userId: USER, action: 'STOREFRONT_DELETE', success: true }]);
  });

  it('senha errada: 401 INVALID_CREDENTIALS e a tentativa fica como falha', async () => {
    const s = setup();
    await expect(s.run('errada')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
    expect(s.attempts.rows).toMatchObject([{ success: false }]);
  });

  it('5 falhas em 15 min: a 6ª responde 429 com retryAfterSeconds e não roda bcrypt nem com a senha certa', async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) {
      await expect(s.run('errada')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      s.clock.ms += 60_000;
    }
    s.verifyPassword.mockClear();
    await expect(s.run(SECRET)).rejects.toMatchObject({
      code: 'PASSWORD_CONFIRMATION_LOCKED', statusCode: 429,
      // `retryAt` (ISO) = relógio da tentativa + espera: é o que vira o header Retry-After
      meta: { retryAfterSeconds: 14 * 60, retryAt: new Date(s.clock.ms + 14 * 60_000).toISOString() },
    });
    expect(s.verifyPassword).not.toHaveBeenCalled();
    expect(s.attempts.rows).toHaveLength(5);
    // bloqueio de 15 min a partir da 5ª falha
    s.clock.ms = T0 + 4 * 60_000 + 15 * 60_000;
    await expect(s.run(SECRET)).resolves.toBeUndefined();
  });

  it('sucesso não zera as falhas anteriores nem conta como falha', async () => {
    const s = setup();
    for (let i = 0; i < 4; i++) await expect(s.run('errada')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await s.run(SECRET);
    await s.run(SECRET);
    await expect(s.run('errada')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(s.run(SECRET)).rejects.toMatchObject({ code: 'PASSWORD_CONFIRMATION_LOCKED' });
  });

  it('usuário sem senha ou inexistente: mesmo 401, e o verificador roda com hash null (sem oráculo)', async () => {
    for (const s of [setup({ hash: null }), setup({ exists: false })]) {
      await expect(s.run(SECRET)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
      expect(s.verifyPassword).toHaveBeenCalledWith(SECRET, null);
      expect(s.attempts.rows).toMatchObject([{ success: false }]);
    }
  });

  it('contador é por usuário', async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) await expect(s.run('errada')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(s.run('errada', 'user-2')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('confirmações em paralelo não passam do teto', async () => {
    const s = setup();
    const out = await Promise.allSettled(Array.from({ length: 12 }, () => s.run('errada')));
    const codes = out.map((r) => (r.status === 'rejected' ? (r.reason as { code: string }).code : 'ok'));
    expect(codes.filter((c) => c === 'INVALID_CREDENTIALS')).toHaveLength(5);
    expect(codes.filter((c) => c === 'PASSWORD_CONFIRMATION_LOCKED')).toHaveLength(7);
    expect(s.verifyPassword).toHaveBeenCalledTimes(5);
  });

  it('erro de infra no meio devolve a tentativa (não custa ao usuário)', async () => {
    const s = setup();
    s.findById.mockRejectedValueOnce(new Error('db down'));
    await expect(s.run(SECRET)).rejects.toThrow('db down');
    expect(s.attempts.rows).toHaveLength(0);
  });

  it('a senha não aparece em nenhum erro nem no que é gravado', async () => {
    const s = setup();
    const err = await s.run(`${SECRET}x`).catch((e) => e);
    expect(JSON.stringify({ m: err.message, meta: err.meta, rows: s.attempts.rows })).not.toContain(SECRET);
  });

  it('poda as tentativas do usuário com mais de 24 h', async () => {
    const s = setup();
    await expect(s.run('errada')).rejects.toBeTruthy();
    s.clock.ms += 25 * 60 * 60_000;
    await s.run(SECRET);
    expect(s.attempts.rows).toMatchObject([{ success: true }]);
  });
});
