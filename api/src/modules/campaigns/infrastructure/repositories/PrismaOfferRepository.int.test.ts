import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaOfferRepository } from './PrismaOfferRepository';
import type { CreateOfferInput } from '../../domain/contracts/IOfferRepository';
import type { OfferOrigin } from '../../domain/enums/OfferOrigin';

/** D4 do caçador: oferta `HUNTER` não mexe no saldo do gerador; gerador e monitoramento seguem contando. */
const repo = new PrismaOfferRepository(prisma);
let tenantId = '';
const SINCE = new Date('2026-01-01T00:00:00.000Z');
const quota = (limit: number) => ({ key: 'offer_generations_per_day', since: SINCE, limit });

const offer = (origin: OfferOrigin): CreateOfferInput => ({
  tenantId, provider: 'SHEIN', sourceUrl: 'https://br.shein.com/x-p-1.html', productRef: '1', title: null,
  priceCents: null, originalPriceCents: null, imageUrl: null, affiliateUrl: 'https://onelink.shein.com/1/x',
  attributionVerified: true, text: 'oferta', coupon: null, audience: 'STANDARD', scheduledAt: null,
  createdById: null, origin,
});

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: 'int', slug: `int-offer-quota-${Date.now()}` } })).id;
});
afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe('PrismaOfferRepository — limite diário do gerador', () => {
  it('HUNTER fica fora de countCreatedSince e de createWithinDailyLimit; demais origens contam', async () => {
    await repo.create(offer('HUNTER'));
    await repo.create(offer('HUNTER'));
    expect(await repo.countCreatedSince(tenantId, SINCE)).toBe(0);

    // Saldo 1 com 2 ofertas do caçador no dia: o gerador ainda cria
    await repo.createWithinDailyLimit(offer('GENERATOR'), quota(1));
    expect(await repo.countCreatedSince(tenantId, SINCE)).toBe(1);
    await expect(repo.createWithinDailyLimit(offer('GENERATOR'), quota(1))).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });

    await repo.create(offer('MONITORING'));
    expect(await repo.countCreatedSince(tenantId, SINCE)).toBe(2);
    await expect(repo.createWithinDailyLimit(offer('GENERATOR'), quota(2))).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });

    // O caçador continua criando (o teto dele é outro) e o total do tenant inclui tudo
    await repo.create(offer('HUNTER'));
    expect(await prisma.offer.count({ where: { tenantId } })).toBe(5);
    expect(await repo.countCreatedSince(tenantId, SINCE)).toBe(2);
  });
});
