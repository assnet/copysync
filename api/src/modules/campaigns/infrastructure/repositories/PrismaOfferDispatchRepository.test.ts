import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { PrismaOfferDispatchRepository } from './PrismaOfferDispatchRepository';

/** SQL do claim sem banco (o comportamento real está no `.int.test.ts`). */
function captureClaimSql() {
  const sqls: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      sqls.push(strings.join('?'));
      return [];
    }),
  };
  const prisma = { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
  return { repo: new PrismaOfferDispatchRepository(prisma), sqls };
}

describe('PrismaOfferDispatchRepository.claimDue', () => {
  it('só reivindica envios de tenant ativo e sem pausa global (suspenso fica na fila)', async () => {
    const { repo, sqls } = captureClaimSql();
    expect(await repo.claimDue(new Date('2026-11-02T12:00:00Z'), 10)).toEqual([]);
    const sql = sqls.join('\n');
    expect(sql).toContain(`"sendingPausedAt" IS NULL AND "status" = 'ACTIVE'::"TenantStatus"`);
  });
});
