import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { UnitOfWork } from '../../../../shared/database/UnitOfWork';
import { PublicSlugKind } from '../../domain/enums/LinkRotationEnums';
import { PrismaLinkRotationRepository } from './PrismaLinkRotationRepository';
import { PrismaPublicSlugRegistry } from './PrismaPublicSlugRegistry';

/** Namespace público (design §4.1): claim/move/release no tx do dono, unique e reserva relida. */
const slugs = new PrismaPublicSlugRegistry(prisma);
const stamp = Date.now();
const DAY = 86_400_000;
let tenantA = '';
let tenantB = '';
let sessionA = '';
let domainId = '';
let domain2 = '';

const inTx = <T>(fn: (s: { slugs: PrismaPublicSlugRegistry; rotations: PrismaLinkRotationRepository }) => Promise<T>) =>
  new UnitOfWork().runInTransaction((tx) => fn({ slugs: new PrismaPublicSlugRegistry(tx), rotations: new PrismaLinkRotationRepository(tx) }));

const createRotation = (slug: string, d = domainId) =>
  inTx(async (tx) => {
    const r = await tx.rotations.create({ tenantId: tenantA, sessionId: sessionA, domainId: d, slug });
    await tx.slugs.claim({ tenantId: tenantA, domainId: d, slug, kind: PublicSlugKind.LINK_ROTATION, ownerId: r.id });
    return r;
  });

beforeAll(async () => {
  tenantA = (await prisma.tenant.create({ data: { name: 'int-a', slug: `int-ps-a-${stamp}` } })).id;
  tenantB = (await prisma.tenant.create({ data: { name: 'int-b', slug: `int-ps-b-${stamp}` } })).id;
  sessionA = (await prisma.session.create({ data: { tenantId: tenantA, name: 's' } })).id;
  domainId = (await prisma.linkDomain.create({ data: { hostname: `ps-${stamp}.test`, premiumNames: ['vip'] } })).id;
  domain2 = (await prisma.linkDomain.create({ data: { hostname: `ps2-${stamp}.test` } })).id;
});
afterAll(async () => {
  await prisma.publicSlugClaim.deleteMany({ where: { domainId: { in: [domainId, domain2] } } });
  await prisma.premiumSlugGrant.deleteMany({ where: { domainId } });
  await prisma.linkRotation.deleteMany({ where: { domainId: { in: [domainId, domain2] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prisma.linkDomain.deleteMany({ where: { id: { in: [domainId, domain2] } } });
  await prisma.$disconnect();
});

describe('PrismaPublicSlugRegistry', () => {
  it('claim no tx: OWNED para o dono, TAKEN para outro, com sugestões', async () => {
    const r = await createRotation('ocupado');
    expect(await slugs.check(tenantA, domainId, 'ocupado')).toMatchObject({
      status: 'OWNED', owner: { kind: 'LINK_ROTATION', ownerId: r.id },
    });
    const other = await slugs.check(tenantB, domainId, 'ocupado');
    expect(other.status).toBe('TAKEN');
    expect(other.suggestions).toHaveLength(5);
  });

  it('unique do claim desfaz o tx inteiro (rodízio não fica)', async () => {
    await createRotation('disputado2');
    const err = await inTx(async (tx) => {
      const r = await tx.rotations.create({ tenantId: tenantA, sessionId: sessionA, domainId: domain2, slug: 'disputado2' });
      await tx.slugs.claim({ tenantId: tenantA, domainId, slug: 'disputado2', kind: PublicSlugKind.LINK_ROTATION, ownerId: r.id });
    }).catch((e) => e);
    expect(err.code).toBe('LINK_SLUG_TAKEN');
    expect(await prisma.linkRotation.count({ where: { domainId: domain2, slug: 'disputado2' } })).toBe(0);
  });

  it('premium: PREMIUM sem grant, AVAILABLE com grant; claim sem grant recusado', async () => {
    expect((await slugs.check(tenantA, domainId, 'vip')).status).toBe('PREMIUM');
    const err = await createRotation('vip').catch((e) => e);
    expect(err.code).toBe('LINK_SLUG_RESERVED');
    await prisma.premiumSlugGrant.create({ data: { domainId, slug: 'vip', tenantId: tenantA, source: 'MANUAL' } });
    expect((await slugs.check(tenantA, domainId, 'vip')).status).toBe('AVAILABLE');
    expect((await slugs.check(tenantB, domainId, 'vip')).status).toBe('PREMIUM');
  });

  it('move troca domínio e reserva o antigo no domínio antigo; release reserva e apaga claim', async () => {
    const r = await createRotation('andarilho');
    const until = new Date(Date.now() + 30 * DAY);
    await inTx(async (tx) => {
      await tx.slugs.move({
        tenantId: tenantA, kind: PublicSlugKind.LINK_ROTATION, ownerId: r.id, newDomainId: domain2, newSlug: 'andarilho', reserveUntil: until,
      });
      await tx.rotations.update(tenantA, r.id, { domainId: domain2, slug: 'andarilho' });
    });
    expect(await prisma.publicSlugClaim.findUnique({ where: { linkRotationId: r.id } })).toMatchObject({ domainId: domain2 });
    expect((await slugs.check(tenantB, domainId, 'andarilho'))).toMatchObject({ status: 'RESERVED', reservedReason: 'RECENT_RELEASE' });

    await inTx(async (tx) => {
      await tx.slugs.release({ tenantId: tenantA, kind: PublicSlugKind.LINK_ROTATION, ownerId: r.id, reserveUntil: until });
      await tx.rotations.delete(tenantA, r.id);
    });
    expect(await prisma.publicSlugClaim.count({ where: { linkRotationId: r.id } })).toBe(0);
    expect((await slugs.check(tenantB, domain2, 'andarilho')).status).toBe('RESERVED');
    expect((await slugs.check(tenantA, domain2, 'andarilho')).status).toBe('AVAILABLE');
  });

  it('rodízio sem claim (janela de deploy) conta como TAKEN', async () => {
    await prisma.linkRotation.create({ data: { tenantId: tenantA, sessionId: sessionA, domainId, slug: 'semclaim' } });
    expect((await slugs.check(tenantB, domainId, 'semclaim')).status).toBe('TAKEN');
  });
});
