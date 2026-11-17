import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaTenantUsageReader } from './PrismaTenantUsageReader';

/** Uso diário na Assinatura: ofertas do caçador fora do gerador (D4); achados do caçador no contador próprio. */
const tenants: string[] = [];
const contacts: string[] = [];
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.saverContact.deleteMany({ where: { id: { in: contacts } } });
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

describe('PrismaTenantUsageReader — Saver', () => {
  it('grupos não removidos, contatos distintos desses grupos e leituras de 24 h sem canceladas, só do tenant', async () => {
    const stamp = Date.now();
    const now = new Date();
    const t = (await prisma.tenant.create({ data: { name: 'int saver usage', slug: `int-sv-usage-${stamp}` } })).id;
    const other = (await prisma.tenant.create({ data: { name: 'int saver usage 2', slug: `int-sv-usage2-${stamp}` } })).id;
    tenants.push(t, other);
    const session = (await prisma.session.create({ data: { tenantId: t, name: 's' } })).id;
    const otherSession = (await prisma.session.create({ data: { tenantId: other, name: 's' } })).id;
    const group = (tenantId: string, sessionId: string, jid: string, removedAt: Date | null = null) =>
      prisma.saverGroup.create({ data: { tenantId, sessionId, groupJid: `${jid}-${stamp}@g.us`, name: 'G', removedAt } });
    const [g1, g2, gone, og] = await Promise.all([
      group(t, session, 'a'), group(t, session, 'b'), group(t, session, 'c', now), group(other, otherSession, 'd'),
    ]);
    const made = await Promise.all([0, 1, 2, 3].map((i) =>
      prisma.saverContact.create({ data: { phone: `98${String(stamp).slice(-8)}${i}`, firstSeenAt: now, lastSeenAt: now } })));
    contacts.push(...made.map((c) => c.id));
    const [c0, c1, c2, c3] = made.map((c) => c.id) as [string, string, string, string];
    const link = (tenantId: string, groupId: string, contactId: string) =>
      ({ tenantId, groupId, contactId, firstExtractedAt: now, lastExtractedAt: now });
    await prisma.saverGroupMembership.createMany({
      data: [link(t, g1.id, c0), link(t, g2.id, c0), link(t, g2.id, c1), link(t, gone.id, c2), link(other, og.id, c3)],
    });
    const ext = await prisma.saverExtraction.create({ data: { tenantId: t, sessionId: session, trigger: 'MANUAL', status: 'DONE', totalGroups: 3 } });
    const oExt = await prisma.saverExtraction.create({ data: { tenantId: other, sessionId: otherSession, trigger: 'MANUAL', status: 'DONE', totalGroups: 1 } });
    const item = (extractionId: string, tenantId: string, sessionId: string, groupId: string, status: 'DONE' | 'CANCELLED', createdAt = now) =>
      ({ extractionId, tenantId, sessionId, groupId, status, createdAt });
    await prisma.saverExtractionItem.createMany({
      data: [
        item(ext.id, t, session, g1.id, 'DONE'),
        item(ext.id, t, session, g2.id, 'CANCELLED'),
        item(ext.id, t, session, gone.id, 'DONE', new Date(now.getTime() - 25 * 60 * 60 * 1000)),
        item(oExt.id, other, otherSession, og.id, 'DONE'),
      ],
    });
    const usage = await new PrismaTenantUsageReader(prisma).read(t);
    expect(usage).toMatchObject({ saverGroups: 2, saverContacts: 2, saverGroupScans: 1 });
  });
});
