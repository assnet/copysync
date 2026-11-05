import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    $executeRawUnsafe: vi.fn(() => 'set-local'),
    $executeRaw: vi.fn(() => 'exec'),
    $queryRaw: vi.fn(() => 'query'),
  },
}));
vi.mock('../../../../shared/database/prisma.client', () => ({ prisma: prismaMock }));

import { PrismaSessionLeaseRepository, SessionLeaseDeadlineError } from './PrismaSessionLeaseRepository';

const MS = 1_000;

describe('PrismaSessionLeaseRepository (fila de transações, F13)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prismaMock.$transaction.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('renew anterior pendurado: o tick novo falha no prazo sem abrir 2ª transação', async () => {
    prismaMock.$transaction.mockImplementation(() => new Promise(() => undefined));
    const repo = new PrismaSessionLeaseRepository(MS);
    const first = repo.renew(['s1'], 'w1', 60_000);
    const firstErr = expect(first).rejects.toBeInstanceOf(SessionLeaseDeadlineError);
    await vi.advanceTimersByTimeAsync(MS);
    await firstErr;
    const second = repo.renew(['s1'], 'w1', 60_000);
    const secondErr = expect(second).rejects.toBeInstanceOf(SessionLeaseDeadlineError);
    await vi.advanceTimersByTimeAsync(MS);
    await secondErr;
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('operação na fila corre quando a anterior assenta dentro do prazo dela', async () => {
    let finish!: (v: unknown) => void;
    prismaMock.$transaction
      .mockImplementationOnce(() => new Promise((r) => { finish = r; }))
      .mockImplementationOnce(async () => [0, [{ id: 's1' }]]);
    const repo = new PrismaSessionLeaseRepository(MS);
    const first = repo.tryAcquire('s1', 'w1', 60_000);
    const second = repo.renew(['s1'], 'w1', 60_000);
    await vi.advanceTimersByTimeAsync(MS / 2);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    finish([0, 1]);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toEqual(['s1']);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('anterior que assenta depois do prazo da seguinte: a seguinte não abre transação', async () => {
    let finish!: (v: unknown) => void;
    prismaMock.$transaction.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    const repo = new PrismaSessionLeaseRepository(MS);
    const first = repo.renew(['s1'], 'w1', 60_000);
    first.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(MS / 2);
    const second = repo.release('s1', 'w1');
    const secondErr = expect(second).rejects.toBeInstanceOf(SessionLeaseDeadlineError);
    await vi.advanceTimersByTimeAsync(MS);
    await secondErr;
    finish([0, []]);
    await vi.advanceTimersByTimeAsync(0);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    // Fila livre de novo: a próxima abre normalmente
    prismaMock.$transaction.mockImplementationOnce(async () => [0, 1]);
    await expect(repo.tryAcquire('s1', 'w1', 60_000)).resolves.toBe(true);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it('erro na anterior não trava a fila', async () => {
    prismaMock.$transaction
      .mockImplementationOnce(async () => { throw new Error('boom'); })
      .mockImplementationOnce(async () => [0, 1]);
    const repo = new PrismaSessionLeaseRepository(MS);
    await expect(repo.release('s1', 'w1')).rejects.toThrow('boom');
    await expect(repo.tryAcquire('s1', 'w1', 60_000)).resolves.toBe(true);
  });
});
