import { Prisma, type PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaPlatformSaverContactRepository, SAVER_SUMMARY_STATEMENT_TIMEOUT } from './PrismaPlatformSaverContactRepository';

const FILTER = { search: null, tenantId: null, from: null, to: null, ddi: null, ddd: null };

/** Prisma falso: `$transaction` recebe as três operações já montadas e devolve o que o teste mandar. */
function fakePrisma(transaction: (ops: unknown[]) => Promise<unknown>) {
  const prisma = {
    $executeRawUnsafe: vi.fn((sql: string) => ({ op: 'exec', sql })),
    $queryRaw: vi.fn(() => ({ op: 'query' })),
    $transaction: vi.fn(transaction),
  };
  return { prisma, repo: new PrismaPlatformSaverContactRepository(prisma as unknown as PrismaClient) };
}

describe('PrismaPlatformSaverContactRepository.countByPhonePrefix', () => {
  it('tempo máximo e as duas contagens na MESMA transação; bigint vira número', async () => {
    const { prisma, repo } = fakePrisma(async () => [0, [{ total: 9n }], [{ prefix: '5511', count: 4n }, { prefix: null, count: 2n }]]);
    await expect(repo.countByPhonePrefix(FILTER, 4)).resolves.toEqual({
      total: 9, prefixes: [{ prefix: '5511', count: 4 }, { prefix: null, count: 2 }],
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = prisma.$transaction.mock.calls[0]![0] as { op: string; sql?: string }[];
    expect(ops.map((o) => o.op)).toEqual(['exec', 'query', 'query']);
    expect(ops[0]!.sql).toBe(`SET LOCAL statement_timeout = '${SAVER_SUMMARY_STATEMENT_TIMEOUT}'`);
  });

  it('statement_timeout (SQLSTATE 57014 no meta ou só a mensagem do Postgres) → 503 SAVER_SUMMARY_UNAVAILABLE', async () => {
    const known = new Prisma.PrismaClientKnownRequestError('Raw query failed', { code: 'P2010', clientVersion: 'test', meta: { code: '57014' } });
    const byMessage = new Error('ERROR: canceling statement due to statement timeout');
    for (const err of [known, byMessage]) {
      const { repo } = fakePrisma(async () => { throw err; });
      await expect(repo.countByPhonePrefix(FILTER, 4)).rejects.toMatchObject({ code: 'SAVER_SUMMARY_UNAVAILABLE', statusCode: 503 });
    }
  });

  it('outro erro é repassado como veio', async () => {
    const other = new Prisma.PrismaClientKnownRequestError('Raw query failed', { code: 'P2010', clientVersion: 'test', meta: { code: '42P01' } });
    for (const err of [other, new Error('connection refused')]) {
      const { repo } = fakePrisma(async () => { throw err; });
      await expect(repo.countByPhonePrefix(FILTER, 4)).rejects.toBe(err);
    }
  });

  it('prefixo de filtro fora de dígitos nunca vira SQL', async () => {
    const { prisma, repo } = fakePrisma(async () => []);
    await expect(repo.countByPhonePrefix({ ...FILTER, ddi: "5' OR 1=1 --" }, 4)).rejects.toThrow('Invalid phone prefix filter');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
