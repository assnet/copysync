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

/** Item RUNNING já pego (claim) para o grupo, como o passo da extração o recebe. */
async function claimedItem(tenantId: string, groupId: string, lockedUntil: Date) {
  const group = await prisma.saverGroup.findUniqueOrThrow({ where: { id: groupId } });
  const ext = await prisma.saverExtraction.create({
    data: { tenantId, sessionId: group.sessionId, trigger: 'MANUAL', status: 'RUNNING', totalGroups: 1 },
  });
  return prisma.saverExtractionItem.create({
    data: { extractionId: ext.id, tenantId, sessionId: group.sessionId!, groupId, status: 'RUNNING', lockedUntil },
  });
}

/** Lê o grupo e grava como o passo da extração fará (T9): item pego, gravação, item DONE. */
async function readGroup(tenantId: string, groupId: string, members: SaverReadMember[], now: Date, extractionId = 'ext') {
  const lockedUntil = new Date(now.getTime() + 60_000);
  const item = await claimedItem(tenantId, groupId, lockedUntil);
  const phones = members.flatMap((m) => (m.phone ? [m.phone] : []));
  const lids = members.flatMap((m) => (m.lid ? [m.lid] : []));
  const result = mergeGroupRead({
    contacts: await platform.findByKeys(phones, lids),
    memberships: await memberships.listGroupMemberships(tenantId, groupId),
    members,
    now,
    extractionId,
  });
  const applied = await platform.applyGroupRead(tenantId, groupId, result, { itemId: item.id, lockedUntil }, () => true);
  await prisma.saverExtractionItem.update({ where: { id: item.id }, data: { status: 'DONE', lockedUntil: null } });
  if (applied.status !== 'APPLIED') throw new Error(applied.status);
  return applied;
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

    const stale = await queue.release({
      itemId: retaken!.id, claimedLockUntil: lock, status: SaverExtractionItemStatus.DONE, attempts: 0, nextAttemptAt: later,
      errorCode: null, finishedAt: later, membersFound: 99, newContacts: 99,
    });
    expect(stale).toBe(false);
    await queue.release({
      itemId: retaken!.id, claimedLockUntil: retaken!.lockedUntil, status: SaverExtractionItemStatus.DONE, attempts: 0, nextAttemptAt: later,
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

describe('pedido sob a trava do tenant', () => {
  it('10 pedidos simultâneos com teto de 2 grupos: só 2 passam; nada gravado nos barrados', async () => {
    const t = await makeTenant('req-race');
    const s = await makeSession(t);
    const guard = (u: { activeCount: number; activeRequested: number }) => {
      if (u.activeCount + 1 - u.activeRequested > 2) throw new Error('LIMIT');
    };
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        queue.requestGroups(
          { tenantId: t, sessionId: s, requestedByUserId: null, groups: [{ groupJid: `rr${i}-${stamp}`, name: null }], scansSince: new Date(0), now },
          guard,
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason.message === 'LIMIT')).toBe(true);
    expect(await groups.countActive(t)).toBe(2);
    expect(await prisma.saverExtraction.count({ where: { tenantId: t } })).toBe(2);
  });

  it('teto diário: pedidos simultâneos não passam da janela; grupo já salvo mantém o nome', async () => {
    const t = await makeTenant('req-scan');
    const s = await makeSession(t);
    await queue.requestGroups(
      { tenantId: t, sessionId: s, requestedByUserId: null, groups: [{ groupJid: `rs-${stamp}`, name: 'Original' }], scansSince: new Date(0), now },
      () => undefined,
    );
    const guard = (u: { scansUsed: number }) => {
      if (u.scansUsed + 1 > 3) throw new Error('SCANS');
    };
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        queue.requestGroups(
          { tenantId: t, sessionId: s, requestedByUserId: null, groups: [{ groupJid: `rs${i}-${stamp}`, name: null }], scansSince: new Date(0), now },
          guard,
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await queue.countScansSince(t, new Date(0))).toBe(3);
    const ext = await queue.requestGroups(
      { tenantId: t, sessionId: s, requestedByUserId: null, groups: [{ groupJid: `rs-${stamp}`, name: null }], scansSince: new Date(0), now },
      () => undefined,
    );
    expect(ext).toMatchObject({ totalGroups: 0, status: 'CANCELLED' });
    expect((await groups.findByJids(t, [`rs-${stamp}`]))[0]?.name).toBe('Original');
  });
});

describe('pedido de super admin (SAVER-47)', () => {
  it('tenant sem produto: cancela só os pendentes de pedido comum; o do super admin segue', async () => {
    const t = await makeTenant('sa');
    const s = await makeSession(t);
    const root = await prisma.user.create({ data: { email: `int-sv-${stamp}-root@x.dev`, name: 'Root', isSuperAdmin: true } });
    const op = await prisma.user.create({ data: { email: `int-sv-${stamp}-op@x.dev`, name: 'Op' } });
    const g1 = await makeGroup(t, s, `sa1-${stamp}@g.us`);
    const g2 = await makeGroup(t, s, `sa2-${stamp}@g.us`);
    const g3 = await makeGroup(t, s, `sa3-${stamp}@g.us`);
    const base = { tenantId: t, sessionId: s, trigger: SaverExtractionTrigger.MANUAL, now };
    const byRoot = await queue.enqueue({ ...base, requestedByUserId: root.id, groupIds: [g1] });
    const byOp = await queue.enqueue({ ...base, requestedByUserId: op.id, groupIds: [g2] });
    const byNobody = await queue.enqueue({ ...base, requestedByUserId: null, groupIds: [g3] });

    expect(await queue.requestedBySuperAdmin(byRoot.id)).toBe(true);
    expect(await queue.requestedBySuperAdmin(byOp.id)).toBe(false);
    expect(await queue.requestedBySuperAdmin(byNobody.id)).toBe(false);

    expect(await queue.cancelPendingByTenant(t, now)).toBe(2);
    expect(await queue.findExtraction(t, byRoot.id)).toMatchObject({ status: 'QUEUED' });
    expect(await queue.findExtraction(t, byOp.id)).toMatchObject({ status: 'CANCELLED' });
    expect(await queue.findExtraction(t, byNobody.id)).toMatchObject({ status: 'CANCELLED' });
  });
});

describe('cancelamento durante a leitura', () => {
  it('grupo removido no meio da leitura: nada gravado, item segue CANCELLED e o grupo não volta', async () => {
    const t = await makeTenant('cancel-read');
    const s = await makeSession(t);
    const g = await makeGroup(t, s, `cancel-read-${stamp}@g.us`);
    const ext = await queue.enqueue({ tenantId: t, sessionId: s, requestedByUserId: null, trigger: SaverExtractionTrigger.MANUAL, groupIds: [g], now });
    const item = await queue.claimNext(s, now, new Date(now.getTime() + 60_000));
    expect(item?.groupId).toBe(g);
    const members = [{ phone: null, lid: `lid${stamp}-x`, name: 'X', isAdmin: false }];
    const result = mergeGroupRead({ contacts: [], memberships: [], members, now, extractionId: ext.id });

    // Remoção concorrente (RemoveSaverGroupUseCase): cancela pendentes e marca o grupo.
    await queue.cancelPendingByGroup(t, g, now);
    await groups.markRemoved(t, g, now);

    const claim = { itemId: item!.id, lockedUntil: item!.lockedUntil };
    expect(await platform.applyGroupRead(t, g, result, claim, () => true)).toEqual({ status: 'CLAIM_LOST' });
    await groups.recordScan(t, g, { sessionId: s, status: SaverExtractionItemStatus.DONE, at: now, memberCount: 1 });
    const released = await queue.release({
      itemId: item!.id, claimedLockUntil: item!.lockedUntil, status: SaverExtractionItemStatus.DONE, attempts: 0,
      nextAttemptAt: now, errorCode: null, finishedAt: now, membersFound: 1, newContacts: 1,
    });
    expect(released).toBe(false);

    expect(await prisma.saverGroupMembership.count({ where: { groupId: g } })).toBe(0);
    expect(await prisma.saverExtractionItem.findUnique({ where: { id: item!.id } })).toMatchObject({ status: 'CANCELLED' });
    expect(await queue.findExtraction(t, ext.id)).toMatchObject({ status: 'CANCELLED', doneGroups: 0, membersFound: 0 });
    expect(await prisma.saverGroup.findUnique({ where: { id: g } })).toMatchObject({ memberCount: 0, lastScannedAt: null });
    expect((await groups.findById(t, g))?.removedAt).not.toBeNull();
    expect(await groups.countActive(t)).toBe(0);
  });

  it('gravação segura a trava do item: cancelamento concorrente espera e o desfecho não é sobrescrito', async () => {
    const t = await makeTenant('cancel-race');
    const s = await makeSession(t);
    const g = await makeGroup(t, s, `cancel-race-${stamp}@g.us`);
    const ext = await queue.enqueue({ tenantId: t, sessionId: s, requestedByUserId: null, trigger: SaverExtractionTrigger.MANUAL, groupIds: [g], now });
    const item = await queue.claimNext(s, now, new Date(now.getTime() + 60_000));
    const members = Array.from({ length: 300 }, (_, i) => ({ phone: null, lid: `lid${stamp}-r${i}`, name: null, isAdmin: false }));
    const result = mergeGroupRead({ contacts: [], memberships: [], members, now, extractionId: ext.id });
    const claim = { itemId: item!.id, lockedUntil: item!.lockedUntil };
    const [applied, cancelled] = await Promise.all([
      platform.applyGroupRead(t, g, result, claim, () => true),
      (async () => {
        await new Promise((r) => setTimeout(r, 5));
        return queue.cancelPendingByGroup(t, g, now);
      })(),
    ]);
    const released = await queue.release({
      itemId: item!.id, claimedLockUntil: item!.lockedUntil, status: SaverExtractionItemStatus.DONE, attempts: 0,
      nextAttemptAt: now, errorCode: null, finishedAt: now,
    });
    const final = await prisma.saverExtractionItem.findUniqueOrThrow({ where: { id: item!.id } });
    // Quem chegou primeiro vence; nunca os dois.
    if (cancelled === 1) {
      expect(released).toBe(false);
      expect(final.status).toBe('CANCELLED');
    } else {
      expect(released).toBe(true);
      expect(final.status).toBe('DONE');
    }
    const links = await prisma.saverGroupMembership.count({ where: { groupId: g } });
    expect(links).toBe(applied.status === 'APPLIED' ? 300 : 0);
  });
});

describe('teto saver_contacts sob a trava do tenant', () => {
  it('duas sessões do tenant gravando ao mesmo tempo não passam do teto; a barrada não grava nada', async () => {
    const t = await makeTenant('cap');
    const fits = ({ used, adding }: { used: number; adding: number }) => used + adding <= 3;
    const reads = await Promise.all(
      ['a', 'b'].map(async (tag) => {
        const s = await makeSession(t);
        const g = await makeGroup(t, s, `cap-${tag}-${stamp}@g.us`);
        const lockedUntil = new Date(now.getTime() + 60_000);
        const item = await claimedItem(t, g, lockedUntil);
        const members = Array.from({ length: 3 }, (_, i) => ({ phone: null, lid: `lid${stamp}-cap${tag}${i}`, name: null, isAdmin: false }));
        const result = mergeGroupRead({ contacts: [], memberships: [], members, now, extractionId: 'ext' });
        return { g, claim: { itemId: item.id, lockedUntil }, result };
      }),
    );
    const outcomes = await Promise.all(reads.map((r) => platform.applyGroupRead(t, r.g, r.result, r.claim, fits)));
    expect(outcomes.map((o) => o.status).sort()).toEqual(['APPLIED', 'LIMIT_REACHED']);
    expect(await memberships.countDistinctContacts(t)).toBe(3);
    const barred = reads[outcomes.findIndex((o) => o.status === 'LIMIT_REACHED')]!;
    expect(await prisma.saverGroupMembership.count({ where: { groupId: barred.g } })).toBe(0);
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
    const filter = { search: null, tenantId: t, from: null, to: null, ddi: null, ddd: null };
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

  it('filtro por DDI/DDD = prefixo do telefone; só LID nunca casa; contagem por prefixo', async () => {
    const t = await makeTenant('ddi');
    const g = await makeGroup(t, await makeSession(t), `ddi-${stamp}@g.us`);
    const tail = String(stamp).slice(-7);
    const phones = [`5511${tail}1`, `5511${tail}2`, `5521${tail}3`, `351${tail}4`, `5531${tail}5`];
    await readGroup(t, g, [
      ...phones.map((phone, i) => ({ phone, lid: null, name: `D${i}`, isAdmin: false })),
      { phone: null, lid: `lid${stamp}ddi`, name: 'Só LID', isAdmin: false },
    ], now);
    const filter = { search: null, tenantId: t, from: null, to: null, ddi: null, ddd: null };
    const listed = async (ddi: string | null, ddd: string | null = null) =>
      (await platform.list({ ...filter, ddi, ddd }, null, 50)).map((r) => r.phone).sort();

    expect(await listed(null)).toHaveLength(6);
    expect(await listed('55')).toEqual([phones[0], phones[1], phones[2], phones[4]].sort());
    expect(await listed('55', '11')).toEqual([phones[0], phones[1]]);
    expect(await listed('351')).toEqual([phones[3]]);
    expect(await listed('44')).toEqual([]);
    // Lista e contagem tratam o só-LID igual: com DDI ele nunca entra.
    for (const ddi of ['55', '351']) {
      const rows = await platform.list({ ...filter, ddi }, null, 50);
      expect(rows.every((r) => r.phone !== null && r.lid !== `lid${stamp}ddi`)).toBe(true);
      const counted = (await platform.countByPhonePrefix({ ...filter, ddi }, 4)).prefixes;
      expect(counted.some((p) => p.prefix === null)).toBe(false);
      expect(counted.reduce((n, p) => n + p.count, 0)).toBe(rows.length);
    }

    const all = await platform.countByPhonePrefix(filter, 3);
    expect(all.total).toBeGreaterThanOrEqual(6);
    const of = (rows: typeof all.prefixes) => Object.fromEntries(rows.map((r) => [String(r.prefix), r.count]));
    expect(of(all.prefixes)).toEqual({ '551': 2, '552': 1, '553': 1, '351': 1, null: 1 });
    const br = await platform.countByPhonePrefix({ ...filter, ddi: '55' }, 4);
    expect(of(br.prefixes)).toEqual({ '5511': 2, '5521': 1, '5531': 1 });
    expect(of((await platform.countByPhonePrefix({ ...filter, ddi: '55', ddd: '21' }, 4)).prefixes)).toEqual({ '5521': 1 });
    await expect(platform.list({ ...filter, ddi: "5' OR 1=1 --" }, null, 5)).rejects.toThrow('Invalid phone prefix filter');
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
