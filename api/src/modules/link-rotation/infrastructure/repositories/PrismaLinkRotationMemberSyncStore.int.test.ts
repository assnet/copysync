import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaLinkRotationMemberSyncStore } from './PrismaLinkRotationMemberSyncStore';
import { PrismaLinkRotationJobLease } from './PrismaLinkRotationJobLease';
import { LinkRotationGroupStatus } from '../../domain/enums/LinkRotationEnums';

/** Job de membros do rodízio: critério de vencido, UPDATE único e lease em job_leases. */
const store = new PrismaLinkRotationMemberSyncStore(prisma);
const lease = new PrismaLinkRotationJobLease(prisma);
const stamp = Date.now();
const NOW = new Date('2026-10-29T12:00:00.000Z');
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const query = { staleBefore: minAgo(15), burstBefore: minAgo(2), clickBurst: 25, limit: 50 };
let tenant = '';
let domainId = '';
let rotationOn = '';
let rotationOff = '';
let sessionOn = '';
let sessionOff = '';
let n = 0;

async function group(rotationId: string, sessionId: string, over: Record<string, unknown> = {}): Promise<string> {
  n++;
  const conv = await prisma.chatConversation.create({ data: { tenantId: tenant, sessionId, isGroup: true, groupJid: `ms${n}` } });
  return (await prisma.linkRotationGroup.create({
    data: { tenantId: tenant, rotationId, conversationId: conv.id, groupJid: `ms${n}`, position: n, capacity: 100, inviteCode: 'c', ...over },
  })).id;
}

beforeAll(async () => {
  tenant = (await prisma.tenant.create({ data: { name: 'int-ms', slug: `int-ms-${stamp}` } })).id;
  sessionOn = (await prisma.session.create({ data: { tenantId: tenant, name: 'on', status: 'CONNECTED' } })).id;
  sessionOff = (await prisma.session.create({ data: { tenantId: tenant, name: 'off', status: 'DISCONNECTED' } })).id;
  domainId = (await prisma.linkDomain.create({ data: { hostname: `int-ms-${stamp}.test` } })).id;
  rotationOn = (await prisma.linkRotation.create({ data: { tenantId: tenant, sessionId: sessionOn, domainId, slug: 'on' } })).id;
  rotationOff = (await prisma.linkRotation.create({ data: { tenantId: tenant, sessionId: sessionOff, domainId, slug: 'off' } })).id;
});
afterAll(async () => {
  await prisma.linkRotation.deleteMany({ where: { domainId } });
  await prisma.tenant.deleteMany({ where: { id: tenant } });
  await prisma.linkDomain.delete({ where: { id: domainId } });
  await prisma.jobLease.deleteMany({ where: { name: { startsWith: `int-${stamp}` } } });
  await prisma.$disconnect();
});

describe('PrismaLinkRotationMemberSyncStore', () => {
  it('listDue: só vencidos de rotação ACTIVE, grupo ACTIVE/FULL, sessão CONNECTED; nulos primeiro', async () => {
    const nunca = await group(rotationOn, sessionOn);
    const velho = await group(rotationOn, sessionOn, { memberCountAt: minAgo(20), status: 'FULL' });
    const rajada = await group(rotationOn, sessionOn, { memberCountAt: minAgo(3), clicksSinceSync: 25 });
    await group(rotationOn, sessionOn, { memberCountAt: minAgo(1), clicksSinceSync: 99 });
    await group(rotationOn, sessionOn, { memberCountAt: minAgo(5) });
    await group(rotationOn, sessionOn, { status: 'PAUSED' });
    await group(rotationOn, sessionOn, { status: 'NEEDS_LINK' });
    await group(rotationOff, sessionOff);
    const paused = (await prisma.linkRotation.create({ data: { tenantId: tenant, sessionId: sessionOn, domainId, slug: 'p', status: 'PAUSED' } })).id;
    await group(paused, sessionOn);

    const due = await store.listDue(query);
    expect(due.map((d) => d.id)).toEqual([nunca, velho, rajada]);
    expect(due[0]).toMatchObject({ tenantId: tenant, rotationId: rotationOn, sessionId: sessionOn, capacity: 100 });
    expect((await store.listDue({ ...query, limit: 1 })).map((d) => d.id)).toEqual([nunca]);
    await prisma.linkRotationGroup.deleteMany({ where: { rotationId: { in: [rotationOn, rotationOff, paused] } } });
  });

  it('applyMemberCount: desconta cliques vistos, troca status só de ACTIVE/FULL; tenant errado não grava', async () => {
    const g = await group(rotationOn, sessionOn, { clicksSinceSync: 30 });
    const p = await group(rotationOn, sessionOn, { status: 'PAUSED', clicksSinceSync: 3 });
    await prisma.linkRotationGroup.update({ where: { id: g }, data: { clicksSinceSync: { increment: 2 } } });
    await store.applyMemberCount({ tenantId: tenant, groupId: g, memberCount: 100, at: NOW, clicksSeen: 30, status: LinkRotationGroupStatus.FULL });
    await store.applyMemberCount({ tenantId: tenant, groupId: p, memberCount: 10, at: NOW, clicksSeen: 9, status: LinkRotationGroupStatus.ACTIVE });
    await store.applyMemberCount({ tenantId: 'outro', groupId: g, memberCount: 1, at: NOW, clicksSeen: 0, status: LinkRotationGroupStatus.ACTIVE });
    const rows = await prisma.linkRotationGroup.findMany({ where: { id: { in: [g, p] } } });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[g]).toMatchObject({ memberCount: 100, memberCountAt: NOW, clicksSinceSync: 2, status: 'FULL' });
    expect(by[p]).toMatchObject({ memberCount: 10, clicksSinceSync: 0, status: 'PAUSED' });

    await store.markAttempt(tenant, g, minAgo(-1));
    expect((await prisma.linkRotationGroup.findUnique({ where: { id: g } }))!).toMatchObject({ memberCount: 100, memberCountAt: minAgo(-1) });
  });
});

describe('PrismaLinkRotationJobLease', () => {
  it('um dono por vez; vencido é tomado; release só do dono', async () => {
    const name = `int-${stamp}-lease`;
    expect(await lease.tryAcquire(name, 'a', minAgo(-5), NOW)).toBe(true);
    expect(await lease.tryAcquire(name, 'b', minAgo(-5), NOW)).toBe(false);
    await lease.release(name, 'b');
    expect(await lease.tryAcquire(name, 'b', minAgo(-15), minAgo(-6))).toBe(true);
    await lease.release(name, 'b');
    expect(await lease.tryAcquire(name, 'c', minAgo(-5), NOW)).toBe(true);
  });
});
