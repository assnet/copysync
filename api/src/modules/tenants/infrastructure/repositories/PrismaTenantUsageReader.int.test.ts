import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaTenantUsageReader } from './PrismaTenantUsageReader';

/** Uso diário na Assinatura: ofertas do caçador fora do gerador (D4); achados do caçador no contador próprio. */
const tenants: string[] = [];
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.$disconnect();
});

const offer = (tenantId: string, origin: 'GENERATOR' | 'HUNTER') => ({
  tenantId, origin, provider: 'SHEIN' as const, sourceUrl: 'https://x.test/p', affiliateUrl: 'https://x.test/a', text: 'oferta',
});

const find = (tenantId: string, goodsId: string, createdAt?: Date) => ({
  tenantId, goodsId, title: 'Item', score: 50, factors: [], ...(createdAt ? { createdAt } : {}),
});

describe('PrismaTenantUsageReader — uso do dia', () => {
  it('gerador não conta ofertas HUNTER; achados de hoje do tenant contam no caçador', async () => {
    const t = (await prisma.tenant.create({ data: { name: 'int usage', slug: `int-usage-${Date.now()}` } })).id;
    const other = (await prisma.tenant.create({ data: { name: 'int usage 2', slug: `int-usage2-${Date.now()}` } })).id;
    tenants.push(t, other);
    await prisma.offer.createMany({ data: [offer(t, 'GENERATOR'), offer(t, 'HUNTER'), offer(t, 'HUNTER')] });
    await prisma.offerHuntFind.createMany({
      data: [find(t, '1'), find(t, '2'), find(t, '3', new Date('2020-01-01T00:00:00.000Z')), find(other, '4')],
    });
    const usage = await new PrismaTenantUsageReader(prisma).read(t);
    expect(usage.offerGenerationsToday).toBe(1);
    expect(usage.offerHunterFindsToday).toBe(2);
  });
});
