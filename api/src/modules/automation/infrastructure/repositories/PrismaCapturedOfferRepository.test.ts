import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaCapturedOfferRepository } from './PrismaCapturedOfferRepository';

/** Só o roteamento por flag; SQL coberto em `*.fairClaim.int.test.ts` (Postgres local). */
function fakePrisma() {
  const queryRaw = vi.fn(async () => []);
  const $transaction = vi.fn(async (ops: unknown[]) => ops.map(() => []));
  const $executeRawUnsafe = vi.fn((_sql: string) => 'set');
  return { prisma: { $queryRaw: queryRaw, $transaction, $executeRawUnsafe } as unknown as PrismaClient, queryRaw, $transaction, $executeRawUnsafe };
}

describe('PrismaCapturedOfferRepository.claimPending — modo', () => {
  it('padrão (flag false): uma query, sem transação nem timeouts', async () => {
    const f = fakePrisma();
    await new PrismaCapturedOfferRepository(f.prisma).claimPending(3, new Date());
    expect(f.queryRaw).toHaveBeenCalledTimes(1);
    expect(f.$transaction).not.toHaveBeenCalled();
  });

  it('justo: transação com lock_timeout e statement_timeout locais antes do claim', async () => {
    const f = fakePrisma();
    await new PrismaCapturedOfferRepository(f.prisma, { fairClaim: true }).claimPending(3, new Date());
    expect(f.$transaction).toHaveBeenCalledTimes(1);
    const sets = f.$executeRawUnsafe.mock.calls.map((c) => String(c[0]));
    expect(sets[0]).toMatch(/^SET LOCAL lock_timeout = '\d+ms'$/);
    expect(sets[1]).toMatch(/^SET LOCAL statement_timeout = '\d+s'$/);
  });

  it('limit ≤ 0 não consulta em nenhum modo', async () => {
    const f = fakePrisma();
    expect(await new PrismaCapturedOfferRepository(f.prisma, { fairClaim: true }).claimPending(0, new Date())).toEqual([]);
    expect(f.$transaction).not.toHaveBeenCalled();
  });
});
