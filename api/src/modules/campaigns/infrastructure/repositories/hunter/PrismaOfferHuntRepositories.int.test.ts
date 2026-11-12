import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../../../../shared/database/prisma.client';
import { PrismaOfferHuntRepository } from './PrismaOfferHuntRepository';
import { PrismaOfferHuntRunRepository } from './PrismaOfferHuntRunRepository';
import { PrismaOfferHuntFindRepository } from './PrismaOfferHuntFindRepository';
import { PrismaOfferHunterSettingsRepository } from './PrismaOfferHunterSettingsRepository';
import { PrismaBroadcastGroupUsageReader } from '../PrismaBroadcastGroupUsageReader';
import type { CreateOfferHuntInput } from '../../../domain/contracts/hunter/IOfferHuntRepository';
import type { NewOfferHuntFind } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';

/** Caçador (T6): teto atômico com concorrência, saldo parcial, repetição, guarda de execuções e CAS do claim. */
const hunts = new PrismaOfferHuntRepository(prisma);
const runs = new PrismaOfferHuntRunRepository(prisma);
const finds = new PrismaOfferHuntFindRepository(prisma);
const settings = new PrismaOfferHunterSettingsRepository(prisma);
// 2º cliente = 2º pool de conexões: simula outro processo
const other = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } });
const findsB = new PrismaOfferHuntFindRepository(other);
const huntsB = new PrismaOfferHuntRepository(other);

const stamp = Date.now();
const SINCE = new Date('2026-01-01T00:00:00.000Z');
const tenants: string[] = [];

const def = (tenantId: string, patch: Partial<CreateOfferHuntInput> = {}): CreateOfferHuntInput => ({
  tenantId, name: 'Maior comissão', sort: 'BEST_SELLING', categoryId: '4436', commissionBand: 'ABOVE_15', keyword: null,
  filters: { minCommissionPct: 15.5, minRating: 4.2, onlyWithExtra: true }, aiEnabled: false, topN: 3, repeatAfterDays: 7,
  deliveryMode: 'REVIEW', intervalMinutes: 60, windowStartMinute: 0, windowEndMinute: 1440, weekdaysMask: 127,
  nextRunAt: new Date('2026-11-12T10:00:00.000Z'), ...patch,
});

const find = (goodsId: string, huntId: string | null): NewOfferHuntFind => ({
  huntId, runId: null, status: 'PENDING_REVIEW', goodsId, skcCode: null, activityId: null, title: 'Item', imageUrl: 'https://img.ltwebstatic.com/i.jpg', priceCents: 1000,
  originalPriceCents: null, discountPercent: 10, commissionPercent: 15.25, commissionCents: 150, returningCommissionPercent: null,
  returningCommissionCents: null, extraCommissionCents: 0, salesBucket: 100, reviewsBucket: 10, rating: 4.5, score: 61.7,
  factors: [{ key: 'commission', points: 20.5, max: 40 }], aiReason: null,
});

async function tenant(tag: string): Promise<string> {
  const id = (await prisma.tenant.create({ data: { name: `int ${tag}`, slug: `int-hunt-${tag}-${stamp}` } })).id;
  tenants.push(id);
  return id;
}

beforeAll(async () => { await other.$connect(); });
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await other.$disconnect();
  await prisma.$disconnect();
});

describe('PrismaOfferHuntRepository', () => {
  it('cria sob o teto, mapeia códigos da fonte e decimais, edita só no tenant', async () => {
    const t = await tenant('crud');
    const h = (await hunts.createWithinLimit(def(t), 2))!;
    expect(h).toMatchObject({ sort: 'BEST_SELLING', commissionBand: 'ABOVE_15', filters: { minCommissionPct: 15.5, minRating: 4.2, onlyWithExtra: true } });
    const raw = await prisma.offerHunt.findUniqueOrThrow({ where: { id: h.id } });
    expect([raw.sort, raw.commissionBand]).toEqual([12, 4]);
    await hunts.createWithinLimit(def(t), 2);
    expect(await hunts.createWithinLimit(def(t), 2)).toBeNull();
    expect(await hunts.update('other-tenant', h.id, { name: 'x' })).toBeNull();
    expect((await hunts.update(t, h.id, { name: 'Novo', commissionBand: null }))!).toMatchObject({ name: 'Novo', commissionBand: null });
  });

  it('teto de caçadas com concorrência: 2 criações simultâneas com 1 vaga → 1 passa', async () => {
    const t = await tenant('crud-race');
    const r = await Promise.all([hunts.createWithinLimit(def(t), 1), huntsB.createWithinLimit(def(t), 1)]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(await hunts.countByTenant(t)).toBe(1);
  });

  it('falha de fonte: +1 atômico e pausa na 3ª; sucesso zera', async () => {
    const t = await tenant('fail');
    const h = (await hunts.createWithinLimit(def(t), 5))!;
    await Promise.all([hunts.recordSourceFailure(t, h.id, SINCE, 3), huntsB.recordSourceFailure(t, h.id, SINCE, 3)]);
    expect((await hunts.findById(t, h.id))!).toMatchObject({ consecutiveFailures: 2, status: 'ACTIVE' });
    expect(await hunts.recordSourceFailure(t, h.id, SINCE, 3)).toEqual({ consecutiveFailures: 3, paused: true });
    expect((await hunts.findById(t, h.id))!).toMatchObject({ status: 'PAUSED', pauseReason: 'SOURCE_UNAVAILABLE' });
    expect(await hunts.resume(t, h.id, null)).toBe(true);
    expect((await hunts.findById(t, h.id))!).toMatchObject({ status: 'ACTIVE', pauseReason: null, consecutiveFailures: 0 });
  });

  it('claimDue: CAS, 1 por tenant, 2 processos não pegam a mesma; releaseClaim só com o token', async () => {
    const t1 = await tenant('claim1');
    const t2 = await tenant('claim2');
    const now = new Date('2026-11-12T12:00:00.000Z');
    const due = { nextRunAt: new Date('2026-11-12T11:00:00.000Z') };
    const a1 = (await hunts.createWithinLimit(def(t1, due), 5))!;
    await hunts.createWithinLimit(def(t1, { nextRunAt: new Date('2026-11-12T11:30:00.000Z') }), 5);
    await hunts.createWithinLimit(def(t2, due), 5);
    await hunts.createWithinLimit(def(t2, { nextRunAt: new Date('2026-11-12T13:00:00.000Z') }), 5); // futura
    const ours = (c: { hunt: { tenantId: string } }) => c.hunt.tenantId === t1 || c.hunt.tenantId === t2;

    const [x, y] = await Promise.all([hunts.claimDue(now, 10, 60_000), huntsB.claimDue(now, 10, 60_000)]);
    const claimed = [...x, ...y].filter(ours);
    expect(claimed.map((c) => c.hunt.tenantId).sort()).toEqual([t1, t2].sort());
    expect(claimed.find((c) => c.hunt.tenantId === t1)!.hunt.id).toBe(a1.id); // a mais vencida
    // Posse vigente: ninguém mais pega desses tenants
    expect((await hunts.claimDue(now, 10, 60_000)).filter(ours)).toHaveLength(0);

    const c1 = claimed.find((c) => c.hunt.tenantId === t1)!;
    expect(await hunts.releaseClaim(t1, c1.hunt.id, 'token-velho', null)).toBe(false);
    expect(await hunts.releaseClaim(t1, c1.hunt.id, c1.claimToken, new Date('2026-11-12T14:00:00.000Z'))).toBe(true);
    // Solta a do t1: a 2ª caçada dele vence agora
    const next = (await hunts.claimDue(now, 10, 60_000)).filter(ours);
    expect(next).toHaveLength(1);
    expect(next[0]!.hunt.tenantId).toBe(t1);
    expect(next[0]!.hunt.id).not.toBe(a1.id);
    // Posse expirada volta a ser reivindicável
    const later = new Date(now.getTime() + 120_000);
    expect((await hunts.claimDue(later, 10, 60_000)).filter(ours).map((c) => c.hunt.tenantId).sort()).toEqual([t1, t2].sort());
  });
});

describe('PrismaOfferHuntFindRepository — teto diário atômico', () => {
  it('saldo parcial: pede 5, restam 2, grava 2 (na ordem dada)', async () => {
    const t = await tenant('partial');
    expect(await finds.insertWithinDailyLimit(t, ['1', '2', '3'].map((g) => find(`9000${g}`, null)), { since: SINCE, limit: 5 })).toHaveLength(3);
    const got = await finds.insertWithinDailyLimit(t, ['1', '2', '3', '4', '5'].map((g) => find(`1000${g}`, null)), { since: SINCE, limit: 5 });
    expect(got.map((f) => f.goodsId)).toEqual(['10001', '10002']);
    expect(got[0]).toMatchObject({ imageUrl: 'https://img.ltwebstatic.com/i.jpg', commissionPercent: 15.25, rating: 4.5, score: 62, factors: [{ key: 'commission', points: 20.5, max: 40 }] });
    expect(await finds.insertWithinDailyLimit(t, [find('20001', null)], { since: SINCE, limit: 5 })).toEqual([]);
    expect(await finds.countCreatedSince(t, SINCE)).toBe(5);
  });

  it('concorrência: 2 inserções simultâneas não passam do teto', async () => {
    const t = await tenant('race');
    const batch = (p: string) => ['1', '2', '3', '4'].map((g) => find(`${p}000${g}`, null));
    const [a, b] = await Promise.all([
      finds.insertWithinDailyLimit(t, batch('3'), { since: SINCE, limit: 5 }),
      findsB.insertWithinDailyLimit(t, batch('4'), { since: SINCE, limit: 5 }),
    ]);
    expect(a.length + b.length).toBe(5);
    expect(await prisma.offerHuntFind.count({ where: { tenantId: t } })).toBe(5);
  });

  it('repetição por caçada e janela; exclusão da caçada mantém achados e execuções (huntId null)', async () => {
    const t = await tenant('repeat');
    const h = (await hunts.createWithinLimit(def(t), 5))!;
    const run = (await runs.startWithinDailyLimit({ tenantId: t, huntId: h.id, trigger: 'MANUAL', startedAt: new Date() }, { since: SINCE, limit: 24 }))!;
    const [f1] = await finds.insertWithinDailyLimit(t, [{ ...find('55501', h.id), runId: run.id }, find('55502', h.id), find('55503', null)], { since: SINCE, limit: 10 });
    await prisma.offerHuntFind.update({ where: { id: f1!.id }, data: { createdAt: new Date('2025-12-01T00:00:00.000Z') } });
    expect([...(await finds.recentGoodsIds(t, h.id, SINCE))]).toEqual(['55502']);
    expect((await finds.recentGoodsIds(t, h.id, new Date('2025-11-01T00:00:00.000Z'))).size).toBe(2);
    expect(await finds.recentGoodsIds('other-tenant', h.id, SINCE)).toEqual(new Set());

    expect(await finds.transition(t, f1!.id, ['APPROVED'], 'SENT')).toBe(false);
    expect(await finds.transition(t, f1!.id, ['PENDING_REVIEW'], 'DISMISSED', { failureReason: null })).toBe(true);
    expect(await finds.transition('other-tenant', f1!.id, ['DISMISSED'], 'SENT')).toBe(false);

    const page1 = await finds.listByHunt(t, h.id, { limit: 1 });
    const page2 = await finds.listByHunt(t, h.id, { limit: 5, after: { at: page1[0]!.createdAt, id: page1[0]!.id } });
    expect([...page1, ...page2].map((f) => f.goodsId)).toEqual(['55502', '55501']);

    await hunts.delete(t, h.id);
    expect(await prisma.offerHuntFind.count({ where: { tenantId: t, huntId: null } })).toBe(3);
    expect((await prisma.offerHuntRun.findUniqueOrThrow({ where: { id: run.id } })).huntId).toBeNull();
  });
});

describe('PrismaOfferHuntRunRepository — guarda de execuções/dia', () => {
  it('SKIPPED não conta; 2 aberturas simultâneas com 1 vaga → 1 passa; fecha só RUNNING', async () => {
    const t = await tenant('runs');
    const h = (await hunts.createWithinLimit(def(t), 5))!;
    const base = { tenantId: t, huntId: h.id, trigger: 'SCHEDULED' as const, startedAt: new Date() };
    await runs.createSkipped({ ...base, errorCode: 'OFFER_HUNT_DAILY_LIMIT' });
    const first = (await runs.startWithinDailyLimit(base, { since: SINCE, limit: 2 }))!;
    const runsB = new PrismaOfferHuntRunRepository(other);
    const r = await Promise.all([runs.startWithinDailyLimit(base, { since: SINCE, limit: 2 }), runsB.startWithinDailyLimit(base, { since: SINCE, limit: 2 })]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(await runs.countStartedSince(t, SINCE)).toBe(2);
    const counters = { seenCount: 30, matchedCount: 5, chosenCount: 2, sentCount: 0, aiUsed: true, aiFallback: false };
    await runs.finish(t, first.id, { ...counters, status: 'SUCCEEDED', errorCode: null, finishedAt: new Date() });
    await runs.finish(t, first.id, { ...counters, status: 'FAILED', errorCode: 'X', finishedAt: new Date() });
    await runs.incrementSent(t, first.id);
    expect(await prisma.offerHuntRun.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: 'SUCCEEDED', seenCount: 30, sentCount: 1 });
  });
});

describe('Destino do caçador na união de grupos (D3)', () => {
  it('conta como uso "hunter"; grupo também do gerador vira 1 item com os 2 usos; exceptHunter tira', async () => {
    const t = await tenant('union');
    const s = (await prisma.session.create({ data: { tenantId: t, name: 'WA' } })).id;
    const g = (await prisma.chatConversation.create({ data: { tenantId: t, sessionId: s, isGroup: true, groupJid: '777', groupName: 'G', externalChatId: '777@g.us' } })).id;
    const reader = new PrismaBroadcastGroupUsageReader(prisma);
    expect(await settings.get(t)).toBeNull();
    await settings.upsert(t, s, g);
    expect((await reader.listRows(t)).map((r) => r.use)).toEqual(['hunter']);
    expect(await reader.listRows(t, { exceptHunter: true })).toEqual([]);
    await prisma.offerDestination.create({ data: { tenantId: t, conversationId: g } });
    expect((await reader.listCatalog(t)).map((i) => i.usedBy)).toEqual([['generator', 'hunter']]);
    // Remover o grupo de todo lugar tira o destino do caçador
    expect(await reader.removeEverywhere(t, g)).toEqual({ found: true, removed: 2 });
    expect(await settings.get(t)).toMatchObject({ sessionId: s, conversationId: null });
    expect(await reader.listRows(t)).toEqual([]);
  });
});
