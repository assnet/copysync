import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaTenantProductRepository } from './PrismaTenantProductRepository';

/** tenant_products contra o Postgres descartável (docs/acesso-por-produto.md). */
const stamp = Date.now();
const repo = new PrismaTenantProductRepository(prisma);
let tenantA = '';
let tenantB = '';

beforeAll(async () => {
  tenantA = (await prisma.tenant.create({ data: { name: 'Int prod A', slug: `int-prod-a-${stamp}` } })).id;
  tenantB = (await prisma.tenant.create({ data: { name: 'Int prod B', slug: `int-prod-b-${stamp}` } })).id;
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prisma.$disconnect();
});

const base = { planSlug: 'SAVER_LITE', expiresAt: null, source: 'BILLING' as const };

describe('PrismaTenantProductRepository', () => {
  it('upsert concorrente do mesmo (tenant, produto) não duplica', async () => {
    await Promise.all(Array.from({ length: 8 }, () =>
      repo.upsert({ tenantId: tenantA, product: 'SAVER', status: 'ACTIVE', ...base })));
    expect(await prisma.tenantProduct.count({ where: { tenantId: tenantA, product: 'SAVER' } })).toBe(1);
  });

  it('inactiveSince: preenche ao inativar, mantém se segue inativa, limpa ao reativar', async () => {
    const off = await repo.upsert({ tenantId: tenantA, product: 'SAVER', status: 'INACTIVE', ...base });
    expect(off.inactiveSince).toBeInstanceOf(Date);
    const again = await repo.upsert({ tenantId: tenantA, product: 'SAVER', status: 'INACTIVE', ...base });
    expect(again.inactiveSince?.getTime()).toBe(off.inactiveSince?.getTime());
    const on = await repo.upsert({ tenantId: tenantA, product: 'SAVER', status: 'ACTIVE', ...base });
    expect(on.inactiveSince).toBeNull();
    const created = await repo.upsert({ tenantId: tenantB, product: 'AFFILIATES', status: 'INACTIVE', planSlug: null, expiresAt: null, source: 'ADMIN' });
    expect(created.inactiveSince).toBeInstanceOf(Date);
    expect(created.source).toBe('ADMIN');
  });

  it('find/findAll filtram por tenant', async () => {
    expect((await repo.findAll(tenantA)).map((r) => r.product)).toEqual(['SAVER']);
    expect((await repo.findAll(tenantB)).map((r) => r.product)).toEqual(['AFFILIATES']);
    expect(await repo.find(tenantB, 'SAVER')).toBeNull();
    expect((await repo.find(tenantA, 'SAVER'))?.status).toBe('ACTIVE');
  });

  it('aceita cliente de transação: rollback desfaz', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await new PrismaTenantProductRepository(tx).upsert({ tenantId: tenantB, product: 'SAVER', status: 'ACTIVE', ...base });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await repo.find(tenantB, 'SAVER')).toBeNull();
  });
});
