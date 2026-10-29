import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaLinkClickRepository } from './PrismaLinkClickRepository';

/** Cliques por grupo na janela de 7 dias (estatística do painel), sempre por tenant. */
const clicks = new PrismaLinkClickRepository(prisma);
const stamp = Date.now();
const now = new Date('2026-10-29T12:00:00.000Z');
let tenantA = '';
let tenantB = '';
let rotationId = '';
let domainId = '';
const groupIds: string[] = [];

beforeAll(async () => {
  tenantA = (await prisma.tenant.create({ data: { name: 'int-a', slug: `int-lc-a-${stamp}` } })).id;
  tenantB = (await prisma.tenant.create({ data: { name: 'int-b', slug: `int-lc-b-${stamp}` } })).id;
  const sessionId = (await prisma.session.create({ data: { tenantId: tenantA, name: 's' } })).id;
  domainId = (await prisma.linkDomain.create({ data: { hostname: `int-lc-${stamp}.test` } })).id;
  rotationId = (await prisma.linkRotation.create({ data: { tenantId: tenantA, sessionId, domainId, slug: 'stats' } })).id;
  for (let i = 0; i < 2; i++) {
    const conversationId = (await prisma.chatConversation.create({
      data: { tenantId: tenantA, sessionId, isGroup: true, groupJid: `lc${i}` },
    })).id;
    groupIds.push((await prisma.linkRotationGroup.create({
      data: { tenantId: tenantA, rotationId, conversationId, groupJid: `lc${i}`, position: i },
    })).id);
  }
});
afterAll(async () => {
  await prisma.linkRotation.deleteMany({ where: { domainId } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prisma.linkDomain.delete({ where: { id: domainId } });
  await prisma.$disconnect();
});

describe('PrismaLinkClickRepository.countLast7DaysByGroup', () => {
  it('agrupa por grupo na janela, ignora clique sem grupo e outro tenant', async () => {
    const base = { tenantId: tenantA, rotationId, ipHash: 'h', userAgentClass: 'browser' as const };
    const [g0, g1] = groupIds as [string, string];
    await clicks.record({ ...base, groupId: g0, createdAt: new Date('2026-10-28T12:00:00.000Z') });
    await clicks.record({ ...base, groupId: g0, createdAt: new Date('2026-10-25T12:00:00.000Z') });
    await clicks.record({ ...base, groupId: g1, createdAt: new Date('2026-10-29T11:00:00.000Z') });
    await clicks.record({ ...base, groupId: g1, createdAt: new Date('2026-10-20T12:00:00.000Z') });
    await clicks.record({ ...base, groupId: null, createdAt: new Date('2026-10-28T12:00:00.000Z') });

    const byGroup = await clicks.countLast7DaysByGroup(tenantA, rotationId, now);
    expect(Object.fromEntries(byGroup)).toEqual({ [g0]: 2, [g1]: 1 });
    expect((await clicks.countLast7DaysByGroup(tenantB, rotationId, now)).size).toBe(0);
    expect(await clicks.countLast7Days(tenantA, rotationId, now)).toBe(4);
  });
});
