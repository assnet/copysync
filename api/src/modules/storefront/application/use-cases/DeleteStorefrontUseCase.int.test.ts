import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { UnitOfWork } from '../../../../shared/database/UnitOfWork';
import { PrismaAuditLogRepository } from '../../../../shared/audit/PrismaAuditLogRepository';
import { hashPassword } from '../../../../shared/utils/hash';
import { PrismaPublicSlugRegistry } from '../../../link-rotation/infrastructure/repositories/PrismaPublicSlugRegistry';
import { PublicSlugKind } from '../../../link-rotation/domain/enums/LinkRotationEnums';
import { PrismaUserRepository } from '../../../users/infrastructure/repositories/PrismaUserRepository';
import { ConfirmUserPasswordUseCase } from '../../../auth/application/use-cases/ConfirmUserPasswordUseCase';
import { PrismaPasswordConfirmationRepository } from '../../../auth/infrastructure/repositories/PrismaPasswordConfirmationRepository';
import { bcryptPasswordVerifier } from '../../../auth/infrastructure/security/bcryptPasswordVerifier';
import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { PrismaStorefrontRepository } from '../../infrastructure/repositories/PrismaStorefrontRepository';
import { PrismaStorefrontOfferRepository } from '../../infrastructure/repositories/PrismaStorefrontOfferRepository';
import { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';
import { DeleteStorefrontUseCase } from './DeleteStorefrontUseCase';
import { ExtractStorefrontOfferUseCase } from './ExtractStorefrontOfferUseCase';
import {
  FakeEntitlementReader, FakeImageFetcher, FakeImageProcessor, FakeMediaStore, FakeResolveProduct, MEDIA_URL,
} from './storefrontTestFakes';
import type { StorefrontSlugTransaction } from './storefrontUseCaseDeps';

/*
 * Exclusão da Página de Ofertas contra o Postgres descartável: mesma composição do container
 * (registry + repos + auditoria presos ao tx), bcrypt real e storage falso.
 */
const stamp = Date.now();
const SECRET = 'Senha-do-admin-1';
const SLUG = `loja${stamp}`;
const PREMIUM = `vip${stamp}`;
const img = (n: number) => `https://cdn.test/media/storefront-00000000-0000-4000-8000-00000000000${n}.webp`;
const base = { title: 'Ofertas', subtitle: null, colorPrimary: '#15803D', colorBackground: '#F6F7F9', colorCard: '#FFFFFF', categories: [] };

const pages = new PrismaStorefrontRepository(prisma);
const offers = new PrismaStorefrontOfferRepository(prisma);
let failAudit = false;
/** Roda dentro do tx da exclusão, logo depois de listar as ofertas (janela da corrida). */
let afterList: (() => Promise<void>) | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const slugTransaction: StorefrontSlugTransaction = (fn) =>
  new UnitOfWork().runInTransaction((tx) => {
    const audit = new PrismaAuditLogRepository(tx);
    const failing: IAuditLogRepository = { create: async (i) => { await audit.create(i); if (failAudit) throw new Error('audit down'); } };
    const txOffers = new PrismaStorefrontOfferRepository(tx);
    const list = txOffers.listByStorefront.bind(txOffers);
    txOffers.listByStorefront = async (t, id) => { const rows = await list(t, id); await afterList?.(); return rows; };
    return fn({
      slugs: new PrismaPublicSlugRegistry(tx),
      storefronts: new PrismaStorefrontRepository(tx),
      offers: txOffers,
      audit: failing,
    });
  });

const media = new FakeMediaStore();
const useCase = new DeleteStorefrontUseCase({
  storefronts: pages,
  media,
  runInSlugTransaction: slugTransaction,
  confirmPassword: new ConfirmUserPasswordUseCase({
    users: new PrismaUserRepository(),
    attempts: new PrismaPasswordConfirmationRepository(),
    verifyPassword: bcryptPasswordVerifier,
  }),
});

let tenantA = '';
let tenantB = '';
let domainId = '';
let userId = '';

async function seedPage(tenantId: string, slug: string): Promise<string> {
  const page = await pages.create({ tenantId, ...base });
  await pages.update(tenantId, { avatarUrl: img(1), coverUrl: img(2) });
  await prisma.publicSlugClaim.create({ data: { domainId, slug, kind: 'STOREFRONT', tenantId, storefrontId: page.id } });
  for (const [i, imageUrl] of [img(3), null, img(4)].entries()) {
    await offers.create({
      tenantId, storefrontId: page.id, status: i === 0 ? StorefrontOfferStatus.PUBLISHED : StorefrontOfferStatus.DRAFT, position: i,
      provider: 'SHOPEE', sourceUrl: 'https://s.shopee.com.br/x', affiliateUrl: 'https://s.shopee.com.br/x',
      attributionVerified: true, title: `Oferta ${i}`, priceCents: 1000, originalPriceCents: null, imageUrl, category: null,
    });
  }
  return page.id;
}
const run = (password: string) => useCase.execute({ tenantId: tenantA, userId, role: 'ADMIN', isSuperAdmin: false, password });

beforeAll(async () => {
  tenantA = (await prisma.tenant.create({ data: { name: 'int-a', slug: `int-sfd-a-${stamp}` } })).id;
  tenantB = (await prisma.tenant.create({ data: { name: 'int-b', slug: `int-sfd-b-${stamp}` } })).id;
  domainId = (await prisma.linkDomain.create({ data: { hostname: `int-sfd-${stamp}.test`, premiumNames: [PREMIUM] } })).id;
  userId = (await prisma.user.create({ data: { email: `int-sfd-${stamp}@x.com`, name: 'Int', passwordHash: await hashPassword(SECRET) } })).id;
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prisma.linkSlugReservation.deleteMany({ where: { domainId } });
  await prisma.premiumSlugGrant.deleteMany({ where: { domainId } });
  await prisma.linkDomain.deleteMany({ where: { id: domainId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('DeleteStorefrontUseCase (Postgres)', () => {
  it('senha errada: 401 e página, ofertas e claim continuam', async () => {
    const pageId = await seedPage(tenantA, SLUG);
    await expect(run('errada')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
    expect(await prisma.storefrontOffer.count({ where: { storefrontId: pageId } })).toBe(3);
    expect(await prisma.publicSlugClaim.count({ where: { storefrontId: pageId } })).toBe(1);
    expect(media.removed).toHaveLength(0);
  });

  it('auditoria falha: rollback de claim, página e da própria linha de auditoria; nenhuma imagem removida', async () => {
    failAudit = true;
    await expect(run(SECRET)).rejects.toThrow('audit down');
    failAudit = false;
    expect(await pages.findByTenant(tenantA)).toMatchObject({ address: { domainId, slug: SLUG } });
    expect(await prisma.storefrontOffer.count({ where: { tenantId: tenantA } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { tenantId: tenantA, action: 'STOREFRONT_DELETED' } })).toBe(0);
    expect(media.removed).toHaveLength(0);
  });

  it('senha certa: página, ofertas e claim somem; sem reserva; auditoria e imagens; outro tenant reivindica o nome na hora', async () => {
    await run(SECRET);
    expect(await pages.findByTenant(tenantA)).toBeNull();
    expect(await prisma.storefrontOffer.count({ where: { tenantId: tenantA } })).toBe(0);
    expect(await prisma.publicSlugClaim.count({ where: { domainId, slug: SLUG } })).toBe(0);
    expect(await prisma.linkSlugReservation.count({ where: { domainId } })).toBe(0);
    expect([...media.removed].sort()).toEqual([img(1), img(2), img(3), img(4)]);

    const audit = await prisma.auditLog.findMany({ where: { tenantId: tenantA, action: 'STOREFRONT_DELETED' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ userId, meta: { slug: SLUG, domainId, offers: 3, bySuperAdmin: false } });
    expect(JSON.stringify(audit)).not.toContain(SECRET);

    const registry = new PrismaPublicSlugRegistry(prisma);
    expect((await registry.check(tenantB, domainId, SLUG)).status).toBe('AVAILABLE');
    const pageB = await pages.create({ tenantId: tenantB, ...base });
    await slugTransaction(({ slugs }) => slugs.claim({ tenantId: tenantB, domainId, slug: SLUG, kind: PublicSlugKind.STOREFRONT, ownerId: pageB.id }));
    expect((await pages.findByTenant(tenantB))!.address).toEqual({ domainId, slug: SLUG });
    await pages.delete(tenantB);
  });

  it('o tenant pode criar página nova do zero e excluir de novo; sem página responde 404', async () => {
    await seedPage(tenantA, SLUG);
    await run(SECRET);
    expect(await pages.findByTenant(tenantA)).toBeNull();
    await expect(run(SECRET)).rejects.toMatchObject({ code: 'STOREFRONT_NOT_FOUND', statusCode: 404 });
  });

  it('reserva antiga do próprio tenant para o nome é apagada junto (nome realmente livre)', async () => {
    const pageId = await seedPage(tenantA, SLUG);
    await prisma.linkSlugReservation.create({ data: { domainId, slug: SLUG, tenantId: tenantA, expiresAt: new Date(Date.now() + 86_400_000) } });
    await slugTransaction(({ slugs }) => slugs.releaseWithoutReservation({ tenantId: tenantB, kind: PublicSlugKind.STOREFRONT, ownerId: pageId }));
    expect(await prisma.publicSlugClaim.count({ where: { storefrontId: pageId } })).toBe(1); // outro tenant não libera
    await run(SECRET);
    expect(await prisma.linkSlugReservation.count({ where: { domainId, slug: SLUG } })).toBe(0);
  });

  it('corrida com criação de oferta: o INSERT espera a exclusão, falha por página inexistente e apaga a própria imagem', async () => {
    await seedPage(tenantA, SLUG);
    const store = new FakeMediaStore();
    let listed!: () => void;
    const deleteListed = new Promise<void>((r) => { listed = r; });
    // Extração "lenta": só termina de resolver o link depois que a exclusão já listou o que vai apagar
    const resolveProduct = new FakeResolveProduct();
    const slow = { execute: async (t: string, url: string) => { await deleteListed; return resolveProduct.execute(t, url); } };
    const extract = new ExtractStorefrontOfferUseCase({
      storefronts: pages, offers, entitlements: new FakeEntitlementReader(), images: new FakeImageProcessor(),
      media: store, resolveProduct: slow, imageFetcher: new FakeImageFetcher(),
    });
    // A exclusão segura o tx aberto depois de listar: tempo de sobra para o INSERT tentar entrar
    afterList = async () => { listed(); await sleep(400); };
    const creating = extract.execute({ tenantId: tenantA, url: 'https://meli.la/abc' }).then(() => 'created', (e: { code?: string }) => e.code);
    await run(SECRET);
    afterList = null;

    expect(await creating).toBe('STOREFRONT_NOT_FOUND');
    expect(await prisma.storefrontOffer.count({ where: { tenantId: tenantA } })).toBe(0);
    // A imagem gravada pela extração não ficou órfã: foi apagada por quem a criou
    expect(store.saved).toHaveLength(1);
    expect(store.removed).toEqual([`${MEDIA_URL}1.webp`]);
  });

  it('corrida com troca de capa: o UPDATE espera a exclusão e falha (a imagem nova nunca fica fora da lista)', async () => {
    await seedPage(tenantA, SLUG);
    media.removed.length = 0;
    let swap: Promise<string | undefined> | null = null;
    afterList = async () => {
      swap = pages.update(tenantA, { coverUrl: img(9) }).then(() => 'updated', (e: { code?: string }) => e.code);
      await sleep(400);
    };
    await run(SECRET);
    afterList = null;

    // Sem a trava o UPDATE passava no meio e img(9) sumia com a página sem ser removida do storage
    expect(await swap).toBe('STOREFRONT_NOT_FOUND');
    expect([...media.removed].sort()).toEqual([img(1), img(2), img(3), img(4)]);
  });

  it('auditoria guarda só a contagem de imagens a remover', async () => {
    const audit = await prisma.auditLog.findMany({ where: { tenantId: tenantA, action: 'STOREFRONT_DELETED' }, orderBy: { createdAt: 'desc' }, take: 1 });
    expect(audit[0]!.meta).toMatchObject({ offers: 3, images: 4 });
    expect(JSON.stringify(audit[0]!.meta)).not.toContain('.webp');
  });

  it('nome premium liberado continua protegido: próximo dono sem grant é recusado', async () => {
    await prisma.premiumSlugGrant.create({ data: { domainId, slug: PREMIUM, tenantId: tenantA, source: 'MANUAL' } });
    const page = await pages.create({ tenantId: tenantA, ...base });
    await slugTransaction(({ slugs }) => slugs.claim({ tenantId: tenantA, domainId, slug: PREMIUM, kind: PublicSlugKind.STOREFRONT, ownerId: page.id }));
    await run(SECRET);
    expect(await prisma.publicSlugClaim.count({ where: { domainId, slug: PREMIUM } })).toBe(0);
    const pageB = await pages.create({ tenantId: tenantB, ...base });
    await expect(
      slugTransaction(({ slugs }) => slugs.claim({ tenantId: tenantB, domainId, slug: PREMIUM, kind: PublicSlugKind.STOREFRONT, ownerId: pageB.id })),
    ).rejects.toMatchObject({ code: 'LINK_SLUG_RESERVED' });
  });
});
