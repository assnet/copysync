import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaStorefrontRepository } from './PrismaStorefrontRepository';
import { PrismaStorefrontOfferRepository } from './PrismaStorefrontOfferRepository';
import { StorefrontOfferStatus, StorefrontStatus } from '../../domain/enums/StorefrontEnums';
import type { CreateStorefrontOfferInput } from '../../domain/contracts/IStorefrontOfferRepository';
import { StorefrontNotFoundError } from '../../../../shared/errors/internal/StorefrontErrors';

/** Página de Ofertas (design.md §3): endereço pelo claim, isolamento por tenant, reorder em lote. */
const pages = new PrismaStorefrontRepository(prisma);
const offers = new PrismaStorefrontOfferRepository(prisma);
const stamp = Date.now();
let tenantA = '';
let tenantB = '';
let domainId = '';
let pageA = '';

const base = { title: 'Ofertas', subtitle: null, colorPrimary: '#2563EB', colorBackground: '#F5F5F5', colorCard: '#FFFFFF' };
const offer = (over: Partial<CreateStorefrontOfferInput> = {}): CreateStorefrontOfferInput => ({
  tenantId: tenantA, storefrontId: pageA, status: StorefrontOfferStatus.DRAFT, position: 0, provider: 'SHOPEE',
  sourceUrl: 'https://s.shopee.com.br/a', affiliateUrl: 'https://s.shopee.com.br/b', attributionVerified: false, title: 'Item',
  priceCents: 1000, originalPriceCents: null, imageUrl: null, category: null, ...over,
});

beforeAll(async () => {
  tenantA = (await prisma.tenant.create({ data: { name: 'int-a', slug: `int-sf-a-${stamp}` } })).id;
  tenantB = (await prisma.tenant.create({ data: { name: 'int-b', slug: `int-sf-b-${stamp}` } })).id;
  domainId = (await prisma.linkDomain.create({ data: { hostname: `int-sf-${stamp}.test` } })).id;
  pageA = (await pages.create({ tenantId: tenantA, ...base, categories: ['casa', 'moda'] })).id;
  await prisma.publicSlugClaim.create({ data: { domainId, slug: 'ana', kind: 'STOREFRONT', tenantId: tenantA, storefrontId: pageA } });
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prisma.linkDomain.delete({ where: { id: domainId } });
  await prisma.$disconnect();
});

describe('PrismaStorefrontRepository', () => {
  it('findByTenant traz o endereço do claim; outro tenant não vê', async () => {
    expect((await pages.findByTenant(tenantA))!.address).toEqual({ domainId, slug: 'ana' });
    expect(await pages.findByTenant(tenantB)).toBeNull();
  });

  it('update parcial; tenant sem página → StorefrontNotFoundError', async () => {
    const p = await pages.update(tenantA, { subtitle: 'oi', categories: ['moda'] });
    expect(p).toMatchObject({ title: 'Ofertas', subtitle: 'oi', categories: ['moda'], address: { slug: 'ana' } });
    await expect(pages.update(tenantB, { title: 'x' })).rejects.toBeInstanceOf(StorefrontNotFoundError);
  });

  it('setStatus devolve o gravado, ou null sem página', async () => {
    expect(await pages.setStatus(tenantA, StorefrontStatus.PAUSED_BY_PLAN)).toBe(StorefrontStatus.PAUSED_BY_PLAN);
    expect(await pages.setStatus(tenantB, StorefrontStatus.ACTIVE)).toBeNull();
    await pages.setStatus(tenantA, StorefrontStatus.ACTIVE);
  });

  it('findPublicByAddress: só claim STOREFRONT, com status do tenant', async () => {
    const pub = await pages.findPublicByAddress(domainId, 'ANA ');
    expect(pub).toMatchObject({ tenantActive: true, storefront: { id: pageA, address: { domainId, slug: 'ana' } } });
    expect(await pages.findPublicByAddress(domainId, 'nao-existe')).toBeNull();
    await prisma.tenant.update({ where: { id: tenantA }, data: { status: 'SUSPENDED' } });
    expect((await pages.findPublicByAddress(domainId, 'ana'))!.tenantActive).toBe(false);
    await prisma.tenant.update({ where: { id: tenantA }, data: { status: 'ACTIVE' } });
  });

  it('com TransactionClient roda direto na tx (rollback desfaz)', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await new PrismaStorefrontRepository(tx).update(tenantA, { title: 'na tx' });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect((await pages.findByTenant(tenantA))!.title).toBe('Ofertas');
  });
});

describe('PrismaStorefrontOfferRepository', () => {
  it('contagem, posição máxima, reorder, isolamento e limpeza de categoria', async () => {
    const a = await offers.create(offer({ position: 0, category: 'casa' }));
    const b = await offers.create(offer({ position: 1, category: 'moda' }));
    const c = await offers.create(offer({ position: 0, status: StorefrontOfferStatus.PUBLISHED, category: 'casa' }));
    await offers.create(offer({ position: 2 }));

    expect(await offers.countByStorefront(tenantA, pageA)).toEqual({ total: 4, published: 1 });
    expect(await offers.countByStorefront(tenantB, pageA)).toEqual({ total: 0, published: 0 });
    expect(await offers.maxPosition(tenantA, pageA, StorefrontOfferStatus.DRAFT)).toBe(2);
    expect(await offers.maxPosition(tenantB, pageA, StorefrontOfferStatus.DRAFT)).toBeNull();

    const drafts = await offers.listIdsByStatus(tenantA, pageA, StorefrontOfferStatus.DRAFT);
    await offers.setPositions(tenantA, pageA, [...drafts].reverse());
    expect(await offers.listIdsByStatus(tenantA, pageA, StorefrontOfferStatus.DRAFT)).toEqual([...drafts].reverse());
    await offers.setPositions(tenantB, pageA, drafts);
    expect(await offers.listIdsByStatus(tenantA, pageA, StorefrontOfferStatus.DRAFT)).toEqual([...drafts].reverse());

    const all = await offers.listByStorefront(tenantA, pageA);
    expect(all.map((o) => o.status)).toEqual(['DRAFT', 'DRAFT', 'DRAFT', 'PUBLISHED']);
    expect((await offers.listPublished(tenantA, pageA)).map((o) => o.id)).toEqual([c.id]);

    const moved = await offers.setStatus(tenantA, a.id, { status: StorefrontOfferStatus.PUBLISHED, position: 1, publishedAt: new Date() });
    expect(moved).toMatchObject({ status: 'PUBLISHED', position: 1, attributionVerified: false });
    await expect(offers.update(tenantB, b.id, { title: 'x' })).rejects.toBeInstanceOf(StorefrontNotFoundError);
    expect((await offers.update(tenantA, b.id, { priceCents: null })).priceCents).toBeNull();

    expect(await offers.clearCategoriesNotIn(tenantA, pageA, ['casa'])).toBe(1);
    expect(await offers.clearCategoriesNotIn(tenantA, pageA, [])).toBe(2);
    expect((await offers.listByStorefront(tenantA, pageA)).every((o) => o.category === null)).toBe(true);

    await expect(offers.delete(tenantB, a.id)).rejects.toBeInstanceOf(StorefrontNotFoundError);
    await offers.delete(tenantA, a.id);
    expect(await offers.findById(tenantA, a.id)).toBeNull();
  });

  it('delete da página leva claim e ofertas (cascade)', async () => {
    await pages.delete(tenantA);
    expect(await pages.findPublicByAddress(domainId, 'ana')).toBeNull();
    expect(await prisma.storefrontOffer.count({ where: { storefrontId: pageA } })).toBe(0);
  });
});
