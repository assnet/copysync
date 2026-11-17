import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { PrismaLinkRotationMemberSyncStore } from './PrismaLinkRotationMemberSyncStore';

/** `where` do `listDue` sem banco (o comportamento real está no `.int.test.ts`). */
async function tenantWhere(affiliatesGateEnforced?: boolean) {
  const findMany = vi.fn(async (_args: { where: { rotation: { tenant: unknown } } }) => []);
  const prisma = { $queryRaw: vi.fn(async () => [{ id: 's1' }]), linkRotationGroup: { findMany } } as unknown as PrismaClient;
  const now = new Date('2026-11-02T12:00:00Z');
  await new PrismaLinkRotationMemberSyncStore(prisma, 'w1', affiliatesGateEnforced)
    .listDue({ staleBefore: now, burstBefore: now, clickBurst: 10, limit: 5 });
  return findMany.mock.calls[0]![0].where.rotation.tenant;
}

describe('PrismaLinkRotationMemberSyncStore.listDue', () => {
  it('fora de enforce: só tenant ativo, como hoje', async () => {
    expect(await tenantWhere()).toEqual({ status: 'ACTIVE' });
  });

  it('enforce: tenant com Afiliados inativo fica de fora', async () => {
    expect(await tenantWhere(true)).toEqual({
      status: 'ACTIVE',
      tenantProducts: { none: { product: 'AFFILIATES', status: { not: 'ACTIVE' } } },
    });
  });
});
