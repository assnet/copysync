import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { mergeGroupRead, type SaverReadMember } from '../../domain/services/mergeGroupRead';
import { SaverExtractionItemStatus, SaverExtractionTrigger } from '../../domain/enums/SaverEnums';
import { PrismaPlatformSaverContactRepository } from './PrismaPlatformSaverContactRepository';
import { PrismaSaverExtractionQueue } from './PrismaSaverExtractionQueue';
import { PrismaSaverGroupRepository } from './PrismaSaverGroupRepository';
import { PrismaSaverMembershipRepository } from './PrismaSaverMembershipRepository';
import { PrismaSaverSessionStateStore } from './PrismaSaverSessionStateStore';
import { PrismaSaverExportGrantRepository } from './PrismaSaverExportGrantRepository';

/** Repositórios do Saver no Postgres descartável (T8): fila, base da plataforma, isolamento entre tenants. */
const stamp = Date.now();
const ME = `int-sv-me-${stamp}`;
const queue = new PrismaSaverExtractionQueue(prisma, ME);
const states = new PrismaSaverSessionStateStore(prisma, ME);
const groups = new PrismaSaverGroupRepository(prisma);
const memberships = new PrismaSaverMembershipRepository(prisma);
const platform = new PrismaPlatformSaverContactRepository(prisma);
const grants = new PrismaSaverExportGrantRepository(prisma);

const tenantIds: string[] = [];
const phoneBase = `99${String(stamp).slice(-7)}`;

async function makeTenant(tag: string) {
  const tenant = await prisma.tenant.create({ data: { name: tag, slug: `int-sv-${tag}-${stamp}` } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function makeSession(tenantId: string, opts: { owner?: string; deleted?: boolean } = {}) {
  const s = await prisma.session.create({
    data: {
      tenantId,
      name: 's',
      ownerWorkerId: opts.owner ?? ME,
      leaseUntil: new Date(Date.now() + 10 * 60_000),
      deletedAt: opts.deleted ? new Date() : null,
    },
  });
  return s.id;
}

async function makeGroup(tenantId: string, sessionId: string, jid: string, name = 'Grupo') {
  const [g] = await groups.upsertMany(tenantId, sessionId, [{ groupJid: jid, name }]);
  return g!.id;
}

/** Lê o grupo e grava como o passo da extração fará (T9). */
async function readGroup(tenantId: string, groupId: string, members: SaverReadMember[], now: Date, extractionId = 'ext') {
  const phones = members.flatMap((m) => (m.phone ? [m.phone] : []));
  const lids = members.flatMap((m) => (m.lid ? [m.lid] : []));
  const result = mergeGroupRead({
    contacts: await platform.findByKeys(phones, lids),
    memberships: await memberships.listGroupMemberships(tenantId, groupId),
    members,
    now,
    extractionId,
  });
  return platform.applyGroupRead(tenantId, groupId, result);
}

const now = new Date('2026-11-17T12:00:00.000Z');

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  const contactIds = (
    await prisma.saverGroupMembership.findMany({ where: { tenantId: { in: tenantIds } }, select: { contactId: true } })
  ).map((m) => m.contactId);
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.saverContact.deleteMany({ where: { OR: [{ id: { in: contactIds } }, { phone: { startsWith: phoneBase } }, { lid: { startsWith: `lid${stamp}` } }] } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `int-sv-${stamp}` } } });
  await prisma.$disconnect();
});

describe('fila', () => {
  it('10 claims concorrentes da mesma sessão = 1 vencedor; trava vencida é retomada', async () => {
    const t = await makeTenant('claim');
    const s = await makeSession(t);
    const g = await makeGroup(t, s, `claim-${stamp}@g.us`);
    const ext = await queue.enqueue({ tenantId: t, sessionId: s, requestedByUserId: null, trigger: SaverExtractionTrigger.MANUAL, groupIds: [g], now });
    expect(ext.totalGroups).toBe(1);

    const lock = new Date(now.getTime() + 60_000);
    const claims = await Promise.all(Array.from({ length: 10 }, () => queue.claimNext(s, now, lock)));
    const winners = claims.filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({ status: 'RUNNING', groupId: g });
    expect(await queue.claimNext(s, new Date(now.getTime() + 30_000), lock)).toBeNull();

    const later = new Date(now.getTime() + 61_000);
    const retaken = await queue.claimNext(s, later, new Date(later.getTime() + 60_000));
    expect(retaken?.id).toBe(winners[0]!.id);
    expect((await queue.findExtraction(t, ext.id))?.status).toBe('RUNNING');

    await queue.release({
      itemId: retaken!.id, status: SaverExtractionItemStatus.DONE, attempts: 0, nextAttemptAt: later,
      errorCode: null, finishedAt: later, membersFound: 7, newContacts: 3,
    });
    expect(await queue.findExtraction(t, ext.id)).toMatchObject({ status: 'DONE', doneGroups: 1, membersFound: 7, newContacts: 3 });
    expect(await queue.findExtraction('outro-tenant', ext.id)).toBeNull();
  });

  it('grupo pendente não duplica; sessão excluída, alheia ou sem lease não é pega; órfãs canceladas', async () => {
    const t = await makeTenant('pend');
    const s = await makeSession(t);
    const g = await makeGroup(t, s, `pend-${stamp}@g.us`);
    const input = { tenantId: t, sessionId: s, requestedByUserId: null, trigger: SaverExtractionTrigger.MANUAL, groupIds: [g], now };
    await queue.enqueue(input);
    const dup = await queue.enqueue(input);
    expect(dup).toMatchObject({ totalGroups: 0, status: 'CANCELLED' });
    expect(await queue.countScansSince(t, new Date(now.getTime() - 1000))).toBe(1);

    const other = await makeSession(t, { owner: `int-sv-other-${stamp}` });
    const gOther = await makeGroup(t, other, `other-${stamp}@g.us`);
    await queue.enqueue({ ...input, sessionId: other, groupIds: [gOther] });
    expect(await queue.claimNext(other, now, new Date(now.getTime() + 60_000))).toBeNull();

    const gone = await makeSession(t, { deleted: true });
    const gGone = await makeGroup(t, gone, `gone-${stamp}@g.us`);
    const extGone = await queue.enqueue({ ...input, sessionId: gone, groupIds: [gGone] });
    expect(await queue.claimNext(gone, now, new Date(now.getTime() + 60_000))).toBeNull();
    expect(await states.ownedSessionIds()).toContain(s);
    expect(await states.ownedSessionIds()).not.toContain(gone);
    expect(await states.dueSessions([s, other], now)).toEqual([s, other].sort());

    expect(await queue.cancelPendingForDeletedSessions(now)).toBeGreaterThanOrEqual(1);
    expect(await queue.findExtraction(t, extGone.id)).toMatchObject({ status: 'CANCELLED' });

    await states.pause(s, t, new Date(now.getTime() + 15 * 60_000), 'RATE_LIMITED');
    expect(await states.dueSessions([s], now)).toEqual([]);

    await groups.markRemoved(t, g, now);
    expect(await groups.countActive(t)).toBe(2);
    expect(await queue.cancelPendingByGroup(t, g, now)).toBe(1);
  });
});

describe('base da plataforma', () => {
  it('grava 1.000 contatos numa leitura e relê sem duplicar', async () => {
    const t = await makeTenant('mil');
    const s = await makeSession(t);
    const g = await makeGroup(t, s, `mil-${stamp}@g.us`);
    const members = Array.from({ length: 1000 }, (_, i) => ({
      phone: `${phoneBase}${String(i).padStart(4, '0')}`, lid: i % 2 ? `lid${stamp}-${i}` : null, name: i % 3 ? `N${i}` : null, isAdmin: i === 0,
    }));
    const first = await readGroup(t, g, members, now);
    expect(first.created).toBe(1000);
    const again = await readGroup(t, g, members, new Date(now.getTime() + 60_000));
    expect(again.created).toBe(0);
    expect(await memberships.countDistinctContacts(t)).toBe(1000);
    expect(await prisma.saverContact.count({ where: { phone: { startsWith: phoneBase } } })).toBe(1000);
  });

  it('dois tenants gravando a mesma pessoa ao mesmo tempo = 1 contato e 2 vínculos', async () => {
    const ta = await makeTenant('conc-a');
    const tb = await makeTenant('conc-b');
    const ga = await makeGroup(ta, await makeSession(ta), `conc-${stamp}@g.us`);
    const gb = await makeGroup(tb, await makeSession(tb), `conc-${stamp}@g.us`);
    const people = Array.from({ length: 200 }, (_, i) => ({
      phone: `${phoneBase}9${String(i).padStart(3, '0')}`, lid: `lid${stamp}-c${i}`, name: null, isAdmin: false,
    }));
    const [ra, rb] = await Promise.all([readGroup(ta, ga, people, now), readGroup(tb, gb, [...people].reverse(), now)]);
    expect(ra.created + rb.created).toBe(200);
    const ids = new Set([...ra.insertedIds, ...rb.insertedIds]);
    expect(ids.size).toBe(200);
    expect(await prisma.saverGroupMembership.count({ where: { contactId: { in: [...ids] } } })).toBe(400);
  });

  it('fusão LID↔telefone migra vínculos de outros tenants e apaga o absorvido', async () => {
    const ta = await makeTenant('merge-a');
    const tb = await makeTenant('merge-b');
    const ga = await makeGroup(ta, await makeSession(ta), `merge-a-${stamp}@g.us`);
    const gb = await makeGroup(tb, await makeSession(tb), `merge-b-${stamp}@g.us`);
    const phone = `${phoneBase}8001`;
    const lid = `lid${stamp}-m`;
    await readGroup(ta, ga, [{ phone, lid: null, name: 'Tel', isAdmin: false }], now);
    await readGroup(tb, gb, [{ phone: null, lid, name: 'Lid', isAdmin: false }], new Date(now.getTime() + 1000));
    expect(await prisma.saverContact.count({ where: { OR: [{ phone }, { lid }] } })).toBe(2);

    await readGroup(ta, ga, [{ phone, lid, name: null, isAdmin: false }], new Date(now.getTime() + 2000));
    const left = await prisma.saverContact.findMany({ where: { OR: [{ phone }, { lid }] } });
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ phone, lid });
    const links = await platform.findLinks(left[0]!.id);
    expect(links.map((l) => l.tenantId).sort()).toEqual([ta, tb].sort());
  });

  it('lista com keyset e filtro por tenant', async () => {
    const t = await makeTenant('list');
    const g = await makeGroup(t, await makeSession(t), `list-${stamp}@g.us`);
    await readGroup(t, g, Array.from({ length: 5 }, (_, i) => ({ phone: `${phoneBase}7${i}`, lid: null, name: `L${i}`, isAdmin: false })), now);
    const filter = { search: null, tenantId: t, from: null, to: null };
    const page1 = await platform.list(filter, null, 3);
    expect(page1).toHaveLength(3);
    const last = page1[2]!;
    const page2 = await platform.list(filter, { lastSeenAt: last.lastSeenAt, id: last.id }, 3);
    expect(page2).toHaveLength(2);
    expect(new Set([...page1, ...page2].map((r) => r.id)).size).toBe(5);
    expect(page1[0]).toMatchObject({ tenantCount: 1, groupCount: 1 });
    expect(await platform.list({ ...filter, search: 'L3' }, null, 10)).toHaveLength(1);
    expect(await platform.list({ ...filter, search: `+${phoneBase}74` }, null, 10)).toHaveLength(1);
  });
});

describe('isolamento do tenant (SAVER-46)', () => {
  it('exportação do tenant A não traz nome, grupo nem data do tenant B', async () => {
    const ta = await makeTenant('iso-a');
    const tb = await makeTenant('iso-b');
    const ga = await makeGroup(ta, await makeSession(ta), `iso-a-${stamp}@g.us`, 'Grupo A');
    const gb = await makeGroup(tb, await makeSession(tb), `iso-b-${stamp}@g.us`, 'Grupo B');
    const phone = `${phoneBase}6001`;
    await readGroup(ta, ga, [{ phone, lid: null, name: null, isAdmin: false }], now);
    const later = new Date(now.getTime() + 3_600_000);
    await readGroup(tb, gb, [{ phone, lid: null, name: 'Nome do B', isAdmin: true }], later);

    const base = { tenantId: ta, onlyWithPhone: false, onlyActive: false, excludeAdmins: false };
    const rows: unknown[] = [];
    for await (const batch of memberships.exportBatches({ ...base, groupIds: [ga, gb], onePerGroup: true }, 10)) rows.push(...batch);
    expect(rows).toEqual([
      expect.objectContaining({ phone, name: null, groupName: 'Grupo A', isAdmin: false, extractedAt: now }),
    ]);
    const perContact: unknown[] = [];
    for await (const batch of memberships.exportBatches({ ...base, groupIds: [ga], onePerGroup: false }, 10)) perContact.push(...batch);
    expect(perContact).toEqual([expect.objectContaining({ name: null, extractedAt: now, groupName: null })]);
    expect(await memberships.countForExport({ ...base, groupIds: [ga, gb], onePerGroup: false })).toEqual({ total: 1, withPhone: 1, lidOnly: 0 });
    expect(await memberships.countForExport({ ...base, tenantId: tb, groupIds: [ga], onePerGroup: false })).toEqual({ total: 0, withPhone: 0, lidOnly: 0 });
  });

  it('exportação em lotes por keyset percorre tudo sem repetir', async () => {
    const t = await makeTenant('batch');
    const g = await makeGroup(t, await makeSession(t), `batch-${stamp}@g.us`);
    await readGroup(t, g, Array.from({ length: 25 }, (_, i) => ({ phone: `${phoneBase}5${String(i).padStart(2, '0')}`, lid: null, name: null, isAdmin: false })), now);
    const seen: string[] = [];
    let batches = 0;
    for await (const batch of memberships.exportBatches(
      { tenantId: t, groupIds: [g], onlyWithPhone: true, onlyActive: true, excludeAdmins: true, onePerGroup: false }, 10,
    )) {
      batches++;
      seen.push(...batch.map((r) => r.contactId));
    }
    expect(batches).toBe(3);
    expect(new Set(seen).size).toBe(25);
  });

  it('liberação: ligar duas vezes = 1 linha; sair do tenant apaga', async () => {
    const t = await makeTenant('grant');
    const user = await prisma.user.create({ data: { email: `int-sv-${stamp}@x.dev`, name: 'Op' } });
    await prisma.userTenant.create({ data: { userId: user.id, tenantId: t } });
    await grants.grant(t, user.id, user.id);
    await grants.grant(t, user.id, user.id);
    expect(await grants.listByTenant(t)).toHaveLength(1);
    expect(await grants.hasGrant(t, user.id)).toBe(true);
    await prisma.userTenant.delete({ where: { userId_tenantId: { userId: user.id, tenantId: t } } });
    expect(await grants.hasGrant(t, user.id)).toBe(false);
  });
});
