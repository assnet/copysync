import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaLinkRotationMemberSyncStore } from './PrismaLinkRotationMemberSyncStore';
import { PrismaLinkRotationJobLease } from './PrismaLinkRotationJobLease';
import { LinkRotationGroupStatus } from '../../domain/enums/LinkRotationEnums';

/** Job de membros do rodízio: critério de vencido, UPDATE único e lease em job_leases. */
const stamp = Date.now();
const ME = `int-ms-a-${stamp}`;
const OTHER = `int-ms-b-${stamp}`;
const store = new PrismaLinkRotationMemberSyncStore(prisma, ME);
const storeB = new PrismaLinkRotationMemberSyncStore(prisma, OTHER);
const lease = new PrismaLinkRotationJobLease(prisma);
/** Lease de sessão pelo relógio do banco (o mesmo que `listDue` compara). */
async function setLease(sessionId: string, owner: string | null, secondsFromNow: number | null): Promise<void> {
  await prisma.$executeRaw`UPDATE "sessions" SET "ownerWorkerId" = ${owner},
    "leaseUntil" = CASE WHEN ${secondsFromNow}::int IS NULL THEN NULL
      ELSE (now() AT TIME ZONE 'UTC') + make_interval(secs => ${secondsFromNow}::int) END
    WHERE "id" = ${sessionId}`;
}
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
  await setLease(sessionOn, ME, 60);
  await setLease(sessionOff, ME, 60);
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

  it('listDue: só grupos de sessões com lease vivo deste processo (B, sem dono e lease vencido ficam de fora)', async () => {
    const mk = async (name: string) => (await prisma.session.create({ data: { tenantId: tenant, name, status: 'CONNECTED' } })).id;
    const sB = await mk('b');
    const sNone = await mk('none');
    const sExpired = await mk('expired');
    await setLease(sB, OTHER, 60);
    await setLease(sNone, null, null);
    await setLease(sExpired, ME, -5);
    const rot = async (sessionId: string, slug: string) =>
      (await prisma.linkRotation.create({ data: { tenantId: tenant, sessionId, domainId, slug } })).id;
    const rB = await rot(sB, 'b');
    const rNone = await rot(sNone, 'none');
    const rExpired = await rot(sExpired, 'exp');
    const mine = await group(rotationOn, sessionOn);
    const ofB = await group(rB, sB);
    await group(rNone, sNone);
    await group(rExpired, sExpired);

    expect((await store.listDue(query)).map((d) => d.id)).toEqual([mine]);
    expect((await storeB.listDue(query)).map((d) => d.id)).toEqual([ofB]);
    expect(await new PrismaLinkRotationMemberSyncStore(prisma, `int-ms-ninguem-${stamp}`).listDue(query)).toEqual([]);
    await prisma.linkRotationGroup.deleteMany({ where: { rotationId: { in: [rotationOn, rB, rNone, rExpired] } } });
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

  it('deleteExpiredByPrefix: só o prefixo, só vencidos antes do corte; `_` do id não é curinga', async () => {
    const p = `int-${stamp}-sync:`;
    const day = 24 * 60;
    const rows = [
      { name: `${p}velho`, expiresAt: minAgo(day + 10) },
      { name: `${p}recente`, expiresAt: minAgo(30) },
      { name: `${p}vivo`, expiresAt: minAgo(-5) },
      { name: `int-${stamp}-outro:velho`, expiresAt: minAgo(day + 10) },
      { name: `int-${stamp}Xsync:velho`, expiresAt: minAgo(day + 10) },
    ];
    await prisma.jobLease.createMany({ data: rows.map((r) => ({ ...r, ownerId: 'x' })) });
    expect(await lease.deleteExpiredByPrefix(p, minAgo(day))).toBe(1);
    expect(await lease.deleteExpiredByPrefix(`int-${stamp}_sync:`, minAgo(day))).toBe(0);
    const left = await prisma.jobLease.findMany({ where: { name: { in: rows.map((r) => r.name) } }, select: { name: true } });
    expect(left.map((r) => r.name).sort()).toEqual(rows.slice(1).map((r) => r.name).sort());
  });
});
