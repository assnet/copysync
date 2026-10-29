import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import { PrismaLinkRotationRepository } from './PrismaLinkRotationRepository';
import { PrismaLinkClickRepository } from './PrismaLinkClickRepository';
import { PrismaLinkRotationSessionReader } from './PrismaLinkRotationSessionReader';
import { PrismaLinkRotationGroupCatalog } from './PrismaLinkRotationGroupCatalog';
import {
  LinkRotationGroupLinkSource,
  LinkRotationGroupStatus,
} from '../../domain/enums/LinkRotationEnums';
import type { SaveLinkRotationGroupInput } from '../../domain/contracts/ILinkRotationRepository';

/** Rodízio de links (design.md §4.5): contagem atômica, slug livre/reservado, troca de grupos. */
const repo = new PrismaLinkRotationRepository(prisma);
const clicks = new PrismaLinkClickRepository(prisma);
const stamp = Date.now();
let tenantA = '';
let tenantB = '';
let sessionA = '';
let domainId = '';
const convs: string[] = [];

const group = (conversationId: string, position: number, over: Partial<SaveLinkRotationGroupInput> = {}): SaveLinkRotationGroupInput => ({
  conversationId,
  groupJid: `jid-${conversationId}`,
  position,
  weight: 1,
  capacity: 500,
  inviteCode: `code-${position}`,
  linkSource: LinkRotationGroupLinkSource.AUTO,
  status: LinkRotationGroupStatus.ACTIVE,
  ...over,
});

beforeAll(async () => {
  tenantA = (await prisma.tenant.create({ data: { name: 'int-a', slug: `int-lr-a-${stamp}` } })).id;
  tenantB = (await prisma.tenant.create({ data: { name: 'int-b', slug: `int-lr-b-${stamp}` } })).id;
  sessionA = (await prisma.session.create({ data: { tenantId: tenantA, name: 's' } })).id;
  domainId = (await prisma.linkDomain.create({ data: { hostname: `int-${stamp}.test` } })).id;
  for (let i = 0; i < 3; i++) {
    convs.push((await prisma.chatConversation.create({
      data: { tenantId: tenantA, sessionId: sessionA, isGroup: true, groupJid: `g${i}` },
    })).id);
  }
});
afterAll(async () => {
  await prisma.linkRotation.deleteMany({ where: { domainId } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await prisma.linkDomain.delete({ where: { id: domainId } });
  await prisma.$disconnect();
});

describe('PrismaLinkRotationRepository', () => {
  it('incrementClick: 10 em paralelo = +10 no grupo e na rotação', async () => {
    const r = await repo.create({ tenantId: tenantA, sessionId: sessionA, domainId, slug: 'paralelo' });
    const [g] = await repo.replaceGroups(tenantA, r.id, [group(convs[0]!, 0)]);
    const at = new Date('2026-10-29T12:00:00.000Z');
    await Promise.all(Array.from({ length: 10 }, () => repo.incrementClick(r.id, g!.id, at)));
    const after = await repo.findById(tenantA, r.id);
    expect(after!.clickCount).toBe(10);
    expect(after!.lastClickAt).toEqual(at);
    expect(after!.groups[0]).toMatchObject({ clickCount: 10, clicksSinceSync: 10, lastClickAt: at });
  });

  it('incrementClick com grupo de outra rotação não conta nada', async () => {
    const r1 = await repo.create({ tenantId: tenantA, sessionId: sessionA, domainId, slug: 'dono' });
    const r2 = await repo.create({ tenantId: tenantA, sessionId: sessionA, domainId, slug: 'intruso' });
    const [g] = await repo.replaceGroups(tenantA, r1.id, [group(convs[1]!, 0)]);
    await expect(repo.incrementClick(r2.id, g!.id, new Date())).rejects.toMatchObject({ code: 'LINK_ROTATION_NOT_FOUND' });
    expect((await repo.findById(tenantA, r2.id))!.clickCount).toBe(0);
    expect((await repo.findById(tenantA, r1.id))!.groups[0]!.clickCount).toBe(0);
  });

  it('isSlugAvailable: ocupado, reserva de outro tenant, vencida, própria', async () => {
    expect(await repo.isSlugAvailable(domainId, 'paralelo', tenantA)).toBe(false);
    expect(await repo.isSlugAvailable(domainId, 'livre', tenantB)).toBe(true);

    const future = new Date(Date.now() + 86_400_000);
    await repo.reserveSlug(domainId, 'reservado', tenantA, future);
    expect(await repo.isSlugAvailable(domainId, 'reservado', tenantB)).toBe(false);
    expect(await repo.isSlugAvailable(domainId, 'reservado', tenantA)).toBe(true);

    await repo.reserveSlug(domainId, 'reservado', tenantA, new Date(Date.now() - 1000));
    expect(await repo.isSlugAvailable(domainId, 'reservado', tenantB)).toBe(true);

    // upsert: reserva vencida passa para o novo dono
    await repo.reserveSlug(domainId, 'reservado', tenantB, future);
    expect(await repo.isSlugAvailable(domainId, 'reservado', tenantA)).toBe(false);
    expect(await prisma.linkSlugReservation.count({ where: { domainId, slug: 'reservado' } })).toBe(1);
  });

  it('create no mesmo (domínio, slug) → LINK_SLUG_TAKEN com sugestões vazias', async () => {
    await expect(repo.create({ tenantId: tenantA, sessionId: sessionA, domainId, slug: 'paralelo' }))
      .rejects.toMatchObject({ code: 'LINK_SLUG_TAKEN', meta: { suggestions: [] } });
  });

  it('replaceGroups preserva contadores de quem fica, apaga quem sai, cria novos', async () => {
    const r = await repo.create({ tenantId: tenantA, sessionId: sessionA, domainId, slug: 'troca' });
    const first = await repo.replaceGroups(tenantA, r.id, [group(convs[0]!, 0), group(convs[1]!, 1)]);
    const kept = first.find((g) => g.conversationId === convs[0])!;
    const memberAt = new Date('2026-10-29T10:00:00.000Z');
    await prisma.linkRotationGroup.update({ where: { id: kept.id }, data: { memberCount: 120, memberCountAt: memberAt } });
    await repo.incrementClick(r.id, kept.id, new Date('2026-10-29T11:00:00.000Z'));
    await repo.incrementClick(r.id, kept.id, new Date('2026-10-29T11:00:00.000Z'));

    const next = await repo.replaceGroups(tenantA, r.id, [
      group(convs[2]!, 0),
      group(convs[0]!, 1, { weight: 7, capacity: 900, inviteCode: null, linkSource: null, status: LinkRotationGroupStatus.NEEDS_LINK }),
    ]);
    expect(next.map((g) => g.conversationId)).toEqual([convs[2], convs[0]]);
    const same = next.find((g) => g.conversationId === convs[0])!;
    expect(same).toMatchObject({
      id: kept.id, clickCount: 2, clicksSinceSync: 2, memberCount: 120, memberCountAt: memberAt,
      position: 1, weight: 7, capacity: 900, inviteCode: null, linkSource: null, status: 'NEEDS_LINK',
    });
    expect(next.find((g) => g.conversationId === convs[2])!.clickCount).toBe(0);
    expect(await prisma.linkRotationGroup.count({ where: { rotationId: r.id, conversationId: convs[1] } })).toBe(0);
  });

  it('tenant-aware: outro tenant não lê, não altera, não apaga', async () => {
    const r = await repo.create({ tenantId: tenantA, sessionId: sessionA, domainId, slug: 'privado' });
    expect(await repo.findById(tenantB, r.id)).toBeNull();
    await expect(repo.update(tenantB, r.id, { title: 'x' })).rejects.toMatchObject({ code: 'LINK_ROTATION_NOT_FOUND' });
    await expect(repo.delete(tenantB, r.id)).rejects.toMatchObject({ code: 'LINK_ROTATION_NOT_FOUND' });
    await expect(repo.replaceGroups(tenantB, r.id, [])).rejects.toMatchObject({ code: 'LINK_ROTATION_NOT_FOUND' });
    expect(await repo.countByTenant(tenantB)).toBe(0);
    await repo.delete(tenantA, r.id);
    expect(await repo.findById(tenantA, r.id)).toBeNull();
  });

  it('findPublicByHost: host em qualquer caixa, tenant suspenso, domínio pausado', async () => {
    const pub = await repo.findPublicByHost(`INT-${stamp}.TEST`, 'Paralelo');
    expect(pub).toMatchObject({ tenantActive: true, rotation: { slug: 'paralelo' }, domain: { id: domainId } });
    expect(pub!.rotation.groups).toHaveLength(1);
    expect(await repo.findPublicByHost(`int-${stamp}.test`, 'nao-existe')).toBeNull();

    await prisma.tenant.update({ where: { id: tenantA }, data: { status: 'SUSPENDED' } });
    expect((await repo.findPublicByHost(`int-${stamp}.test`, 'paralelo'))!.tenantActive).toBe(false);
    await prisma.tenant.update({ where: { id: tenantA }, data: { status: 'ACTIVE' } });

    await prisma.linkDomain.update({ where: { id: domainId }, data: { status: 'PAUSED' } });
    expect(await repo.findPublicByHost(`int-${stamp}.test`, 'paralelo')).toBeNull();
    await prisma.linkDomain.update({ where: { id: domainId }, data: { status: 'ACTIVE' } });
  });
});

describe('PrismaLinkRotationRepository (T7)', () => {
  it('update com outra sessão apaga os grupos; mesma sessão mantém', async () => {
    const sessionA2 = (await prisma.session.create({ data: { tenantId: tenantA, name: 's2' } })).id;
    const r = await repo.create({ tenantId: tenantA, sessionId: sessionA, domainId, slug: 'troca-sessao' });
    await repo.replaceGroups(tenantA, r.id, [group(convs[0]!, 0)]);
    await repo.update(tenantA, r.id, { sessionId: sessionA, title: 't' });
    expect((await repo.findById(tenantA, r.id))!.groups).toHaveLength(1);
    const out = await repo.update(tenantA, r.id, { sessionId: sessionA2 });
    expect(out.sessionId).toBe(sessionA2);
    expect((await repo.findById(tenantA, r.id))!.groups).toHaveLength(0);
    await repo.delete(tenantA, r.id);
  });

  it('update para slug ocupado → LINK_SLUG_TAKEN', async () => {
    const r = await repo.create({ tenantId: tenantA, sessionId: sessionA, domainId, slug: 'vai-colidir' });
    await expect(repo.update(tenantA, r.id, { slug: 'paralelo' })).rejects.toMatchObject({ code: 'LINK_SLUG_TAKEN' });
    await repo.delete(tenantA, r.id);
  });

  it('findUnavailableSlugs: ocupados e reservados de outro tenant, sem duplicar', async () => {
    await repo.reserveSlug(domainId, 'lote-reservado', tenantB, new Date(Date.now() + 86_400_000));
    const out = await repo.findUnavailableSlugs(domainId, ['paralelo', 'lote-livre', 'lote-reservado', 'paralelo'], tenantA);
    expect(out.sort()).toEqual(['lote-reservado', 'paralelo']);
    expect(await repo.findUnavailableSlugs(domainId, ['lote-reservado'], tenantB)).toEqual([]);
    expect(await repo.findUnavailableSlugs(domainId, [], tenantA)).toEqual([]);
  });

  it('updateGroup: patch parcial e tenant-aware', async () => {
    const r = await repo.create({ tenantId: tenantA, sessionId: sessionA, domainId, slug: 'patch-grupo' });
    const [g] = await repo.replaceGroups(tenantA, r.id, [group(convs[2]!, 0)]);
    const at = new Date('2026-10-29T12:00:00.000Z');
    const out = await repo.updateGroup(tenantA, r.id, g!.id, {
      memberCount: 77, memberCountAt: at, clicksSinceSync: 0, status: LinkRotationGroupStatus.FULL, inviteCode: null, linkSource: null,
    });
    expect(out).toMatchObject({ id: g!.id, memberCount: 77, memberCountAt: at, status: 'FULL', inviteCode: null, weight: 1, capacity: 500 });
    await expect(repo.updateGroup(tenantB, r.id, g!.id, { memberCount: 1 })).rejects.toMatchObject({ code: 'LINK_ROTATION_NOT_FOUND' });
    await repo.delete(tenantA, r.id);
  });
});

describe('PrismaLinkRotationSessionReader / PrismaLinkRotationGroupCatalog', () => {
  it('sessões do tenant sem as excluídas; grupos só isGroup do tenant', async () => {
    const sessions = new PrismaLinkRotationSessionReader(prisma);
    const deleted = (await prisma.session.create({ data: { tenantId: tenantA, name: 'del', deletedAt: new Date() } })).id;
    const list = await sessions.listByTenant(tenantA);
    expect(list.map((s) => s.id)).toContain(sessionA);
    expect(list.map((s) => s.id)).not.toContain(deleted);
    expect(await sessions.findById(tenantA, deleted)).toBeNull();
    expect(await sessions.findById(tenantB, sessionA)).toBeNull();
    expect(await sessions.findById(tenantA, sessionA)).toMatchObject({ id: sessionA, name: 's', status: 'PENDING' });

    const catalog = new PrismaLinkRotationGroupCatalog(prisma);
    const contact = (await prisma.chatConversation.create({ data: { tenantId: tenantA, sessionId: sessionA, isGroup: false } })).id;
    const found = await catalog.findGroups(tenantA, [convs[0]!, contact]);
    expect(found).toEqual([{ conversationId: convs[0], sessionId: sessionA, groupJid: 'g0', name: null }]);
    expect(await catalog.findGroups(tenantB, [convs[0]!])).toEqual([]);
  });
});

describe('PrismaLinkClickRepository', () => {
  it('countLast7Days conta a janela; deleteOlderThan corta por idade', async () => {
    const r = (await repo.findPublicByHost(`int-${stamp}.test`, 'paralelo'))!.rotation;
    const now = new Date('2026-10-29T12:00:00.000Z');
    const base = { tenantId: tenantA, rotationId: r.id, groupId: r.groups[0]!.id, ipHash: 'h', userAgentClass: 'browser' as const };
    await clicks.record({ ...base, createdAt: new Date('2026-10-28T12:00:00.000Z') });
    await clicks.record({ ...base, createdAt: new Date('2026-10-23T12:00:00.000Z') });
    await clicks.record({ ...base, createdAt: new Date('2026-10-20T12:00:00.000Z') });
    expect(await clicks.countLast7Days(tenantA, r.id, now)).toBe(2);
    expect(await clicks.countLast7Days(tenantB, r.id, now)).toBe(0);
    expect(await clicks.deleteOlderThan(new Date('2026-10-21T00:00:00.000Z'))).toBe(1);
    expect(await clicks.countLast7Days(tenantA, r.id, now)).toBe(2);
  });
});

describe('exclusão de tenant', () => {
  it('cascade do tenant apaga sessão e rotações sem esbarrar na FK da sessão', async () => {
    const t = (await prisma.tenant.create({ data: { name: 'int-c', slug: `int-lr-c-${stamp}` } })).id;
    const s = (await prisma.session.create({ data: { tenantId: t, name: 's' } })).id;
    await repo.create({ tenantId: t, sessionId: s, domainId, slug: `cascade-${stamp}` });
    await prisma.tenant.delete({ where: { id: t } });
    expect(await prisma.linkRotation.count({ where: { tenantId: t } })).toBe(0);
    expect(await prisma.session.count({ where: { tenantId: t } })).toBe(0);
  });
});
