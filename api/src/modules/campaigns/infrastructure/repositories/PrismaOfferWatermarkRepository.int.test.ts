import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaOfferWatermarkRepository } from './PrismaOfferWatermarkRepository';

/** Marca d'água própria (design.md "Imagem das ofertas"): upsert por tenant, isolamento, troca de tipo. */
const repo = new PrismaOfferWatermarkRepository(prisma);
const stamp = Date.now();
let tenantA = '';
let tenantB = '';

beforeAll(async () => {
  tenantA = (await prisma.tenant.create({ data: { name: 'int-a', slug: `int-wm-a-${stamp}` } })).id;
  tenantB = (await prisma.tenant.create({ data: { name: 'int-b', slug: `int-wm-b-${stamp}` } })).id;
});
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prisma.$disconnect();
});

describe('PrismaOfferWatermarkRepository', () => {
  it('sem registro → null', async () => {
    expect(await repo.findByTenant(tenantA)).toBeNull();
  });

  it('save cria com os padrões do schema; outro tenant não enxerga', async () => {
    const w = await repo.save(tenantA, { imageKey: 'offer-watermarks/a/logo.png' });
    expect(w).toMatchObject({
      tenantId: tenantA, kind: 'IMAGE', imageKey: 'offer-watermarks/a/logo.png', text: null,
      enabled: false, position: 'BOTTOM_RIGHT', size: 'MEDIUM', opacity: 80,
    });
    expect(await repo.findByTenant(tenantB)).toBeNull();
    expect(await repo.findByTenant(tenantA)).toEqual(w);
  });

  it('save de novo é upsert (um registro por tenant), patch parcial', async () => {
    const before = await repo.findByTenant(tenantA);
    const w = await repo.save(tenantA, { text: 'Loja da Ana', enabled: true, position: 'TOP_LEFT', size: 'LARGE', opacity: 35 });
    expect(w.id).toBe(before!.id);
    expect(w).toMatchObject({ imageKey: 'offer-watermarks/a/logo.png', text: 'Loja da Ana', enabled: true, position: 'TOP_LEFT', size: 'LARGE', opacity: 35 });
    expect(await prisma.offerWatermark.count({ where: { tenantId: tenantA } })).toBe(1);
  });

  it('trocar kind preserva imageKey e text', async () => {
    const asText = await repo.save(tenantA, { kind: 'TEXT' });
    expect(asText).toMatchObject({ kind: 'TEXT', imageKey: 'offer-watermarks/a/logo.png', text: 'Loja da Ana' });
    const back = await repo.save(tenantA, { kind: 'IMAGE' });
    expect(back).toMatchObject({ kind: 'IMAGE', imageKey: 'offer-watermarks/a/logo.png', text: 'Loja da Ana' });
  });

  it('null limpa só o campo pedido; o do outro tenant fica intacto', async () => {
    await repo.save(tenantB, { kind: 'TEXT', text: 'Outra' });
    const w = await repo.save(tenantA, { imageKey: null });
    expect(w).toMatchObject({ imageKey: null, text: 'Loja da Ana' });
    expect(await repo.findByTenant(tenantB)).toMatchObject({ tenantId: tenantB, text: 'Outra', imageKey: null });
  });

  it('apagar o tenant apaga a marca (cascade)', async () => {
    const t = (await prisma.tenant.create({ data: { name: 'int-c', slug: `int-wm-c-${stamp}` } })).id;
    await repo.save(t, { text: 'X' });
    await prisma.tenant.delete({ where: { id: t } });
    expect(await repo.findByTenant(t)).toBeNull();
  });
});
