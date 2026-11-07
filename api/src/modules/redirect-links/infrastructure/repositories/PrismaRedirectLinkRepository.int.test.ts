import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaRedirectLinkRepository } from './PrismaRedirectLinkRepository';

/** Links da plataforma (sem tenant): CRUD, slug único, CHECK do percentual e contador atômico. */
const links = new PrismaRedirectLinkRepository(prisma);
const stamp = Date.now();
const slug = (s: string) => `int-${stamp}-${s}`;
const base = { urlA: 'https://a.com/', urlB: null, percentA: 100, isActive: true, note: null };

beforeEach(async () => {
  await prisma.redirectLink.deleteMany({ where: { slug: { startsWith: `int-${stamp}-` } } });
});
afterAll(async () => {
  await prisma.redirectLink.deleteMany({ where: { slug: { startsWith: `int-${stamp}-` } } });
  await prisma.$disconnect();
});

describe('PrismaRedirectLinkRepository', () => {
  it('cria, acha por slug/ativo, edita slug (antigo some) e apaga', async () => {
    const link = await links.create({ ...base, slug: slug('loja') });
    expect(link).toMatchObject({ hitsA: 0, hitsB: 0, isActive: true });
    expect((await links.findActiveBySlug(slug('loja')))?.id).toBe(link.id);

    const renamed = await links.update(link.id, { ...base, slug: slug('loja-v2'), isActive: false });
    expect(await links.findBySlug(slug('loja'))).toBeNull();
    expect(renamed.slug).toBe(slug('loja-v2'));
    expect(await links.findActiveBySlug(slug('loja-v2'))).toBeNull();

    await links.delete(link.id);
    expect(await links.findById(link.id)).toBeNull();
    await expect(links.delete(link.id)).rejects.toMatchObject({ code: 'REDIRECT_LINK_NOT_FOUND' });
    await expect(links.update(link.id, { ...base, slug: slug('z') })).rejects.toMatchObject({ code: 'REDIRECT_LINK_NOT_FOUND' });
  });

  it('slug repetido = REDIRECT_LINK_SLUG_TAKEN', async () => {
    await links.create({ ...base, slug: slug('dup') });
    await expect(links.create({ ...base, slug: slug('dup') })).rejects.toMatchObject({ code: 'REDIRECT_LINK_SLUG_TAKEN' });
  });

  it('CHECK do banco recusa percentual fora de 0–100', async () => {
    await expect(prisma.redirectLink.create({ data: { ...base, slug: slug('pct'), percentA: 101 } })).rejects.toThrow();
  });

  it('contador concorrente não perde clique e não mexe em updatedAt', async () => {
    const link = await links.create({ ...base, slug: slug('hits'), urlB: 'https://b.com/', percentA: 50 });
    await Promise.all([
      ...Array.from({ length: 40 }, () => links.incrementHit(link.id, 'A')),
      ...Array.from({ length: 25 }, () => links.incrementHit(link.id, 'B')),
    ]);
    const after = await links.findById(link.id);
    expect(after).toMatchObject({ hitsA: 40, hitsB: 25 });
    expect(after!.updatedAt.getTime()).toBe(link.updatedAt.getTime());
  });
});
