import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaLinkRotationPublicStore } from './PrismaLinkRotationPublicStore';

/** Rota pública: dedupe por ipHash, aviso de lotado condicional, nomes filtrados por tenant. */
const store = new PrismaLinkRotationPublicStore(prisma);
const stamp = Date.now();
const NOW = new Date('2026-10-29T12:00:00.000Z');
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);
let tenantA = '';
let tenantB = '';
let sessionA = '';
let domainId = '';
let rotationId = '';
let convId = '';

beforeAll(async () => {
  tenantA = (await prisma.tenant.create({ data: { name: 'int-a', slug: `int-lrp-a-${stamp}` } })).id;
  tenantB = (await prisma.tenant.create({ data: { name: 'int-b', slug: `int-lrp-b-${stamp}` } })).id;
  sessionA = (await prisma.session.create({ data: { tenantId: tenantA, name: 'Principal' } })).id;
  domainId = (await prisma.linkDomain.create({ data: { hostname: `int-pub-${stamp}.test` } })).id;
  convId = (await prisma.chatConversation.create({
    data: { tenantId: tenantA, sessionId: sessionA, isGroup: true, groupJid: 'g1', groupName: 'Ofertas' },
  })).id;
  rotationId = (await prisma.linkRotation.create({ data: { tenantId: tenantA, sessionId: sessionA, domainId, slug: 'pub' } })).id;
  await prisma.linkClick.create({ data: { tenantId: tenantA, rotationId, ipHash: 'h1', userAgentClass: 'browser', createdAt: NOW } });
});
afterAll(async () => {
  await prisma.linkRotation.deleteMany({ where: { domainId } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prisma.linkDomain.delete({ where: { id: domainId } });
  await prisma.$disconnect();
});

describe('PrismaLinkRotationPublicStore', () => {
  it('hasRecentClick: janela, ipHash e tenant', async () => {
    expect(await store.hasRecentClick(tenantA, rotationId, 'h1', min(-10))).toBe(true);
    expect(await store.hasRecentClick(tenantA, rotationId, 'h1', min(1))).toBe(false);
    expect(await store.hasRecentClick(tenantA, rotationId, 'h2', min(-10))).toBe(false);
    expect(await store.hasRecentClick(tenantB, rotationId, 'h1', min(-10))).toBe(false);
  });

  it('markAllFullNotified: grava se null ou vencido; 2 simultâneos gravam 1×', async () => {
    const both = await Promise.all([
      store.markAllFullNotified(tenantA, rotationId, NOW, min(-60)),
      store.markAllFullNotified(tenantA, rotationId, NOW, min(-60)),
    ]);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect(await store.markAllFullNotified(tenantA, rotationId, min(30), min(-30))).toBe(false);
    expect(await store.markAllFullNotified(tenantB, rotationId, min(61), min(1))).toBe(false);
    expect(await store.markAllFullNotified(tenantA, rotationId, min(61), min(1))).toBe(true);
    const row = await prisma.linkRotation.findUnique({ where: { id: rotationId } });
    expect(row!.allFullNotifiedAt).toEqual(min(61));
  });

  it('findLabels: sessão e grupo do tenant; outro tenant não lê', async () => {
    expect(await store.findLabels(tenantA, sessionA, convId)).toEqual({ sessionName: 'Principal', groupName: 'Ofertas' });
    expect(await store.findLabels(tenantA, sessionA, null)).toEqual({ sessionName: 'Principal', groupName: null });
    expect(await store.findLabels(tenantB, sessionA, convId)).toEqual({ sessionName: null, groupName: null });
  });
});
