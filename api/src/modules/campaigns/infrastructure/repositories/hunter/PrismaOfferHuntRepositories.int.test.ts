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

const RANK_ITEM = {
  goodsId: '123456', title: 'Vestido', imageUrl: 'https://img.ltwebstatic.com/a.jpg', priceCents: 5990, discountPercent: 40,
  commissionPercent: 15.5, commissionCents: 928, returningCommissionPercent: 4.9, returningCommissionCents: 293,
  extraCommissionCents: 0, salesBucket: 1000, reviewsBucket: 500, rating: 4.8, score: 81.5,
  factors: [{ key: 'commission' as const, points: 30, max: 40 }], aiReason: null, chosen: true,
};

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
    // Operador da comissão: ausente grava GTE; GT/LT ida e volta; sem % → null
    expect(raw.commissionOperator).toBe('GTE');
    expect((await hunts.update(t, h.id, { filters: { minCommissionPct: 20, commissionOperator: 'GT' } }))!.filters).toMatchObject({ minCommissionPct: 20, commissionOperator: 'GT' });
    expect((await hunts.update(t, h.id, { filters: {} }))!.filters.commissionOperator).toBeNull();
    expect((await prisma.offerHunt.findUniqueOrThrow({ where: { id: h.id } })).commissionOperator).toBeNull();
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

  it('concorrência na mesma caçada: 2 execuções com os mesmos itens não repetem goodsId (anti-join no lock)', async () => {
    const t = await tenant('race-repeat');
    const h = (await hunts.createWithinLimit(def(t), 5))!;
    const batch = ['1', '2', '3'].map((g) => find(`7700${g}`, h.id));
    const quota = { since: SINCE, limit: 10, repeatSince: SINCE };
    const [a, b] = await Promise.all([finds.insertWithinDailyLimit(t, batch, quota), findsB.insertWithinDailyLimit(t, batch, quota)]);
    expect(a.length + b.length).toBe(3);
    expect((await prisma.offerHuntFind.findMany({ where: { tenantId: t }, select: { goodsId: true } })).map((r) => r.goodsId).sort())
      .toEqual(['77001', '77002', '77003']);
    // Repetido no próprio lote e fora da janela: só o 1º do lote; outra caçada não bloqueia
    const h2 = (await hunts.createWithinLimit(def(t), 5))!;
    const got = await finds.insertWithinDailyLimit(t, [find('77001', h2.id), find('77001', h2.id), find('77001', h.id)], quota);
    expect(got.map((f) => [f.huntId, f.goodsId])).toEqual([[h2.id, '77001']]);
  });

  it('reclaimStaleApproved: só APPROVED sem offerId mais velho que o corte; CAS (2º perde)', async () => {
    const t = await tenant('reclaim');
    const [a, b] = await finds.insertWithinDailyLimit(t, [{ ...find('66001', null), status: 'APPROVED' }, { ...find('66002', null), status: 'APPROVED' }], { since: SINCE, limit: 10 });
    const old = new Date(Date.now() - 20 * 60_000);
    await prisma.offerHuntFind.updateMany({ where: { tenantId: t }, data: { updatedAt: old } });
    const cut = new Date(Date.now() - 15 * 60_000);
    expect(await finds.reclaimStaleApproved(t, b!.id, new Date(old.getTime() - 1))).toBe(false);
    const [r1, r2] = await Promise.all([finds.reclaimStaleApproved(t, a!.id, cut), findsB.reclaimStaleApproved(t, a!.id, cut)]);
    expect([r1, r2].filter(Boolean)).toHaveLength(1);
    expect(await finds.reclaimStaleApproved('other-tenant', b!.id, cut)).toBe(false);
    await prisma.offerHuntFind.update({ where: { id: b!.id }, data: { updatedAt: old, offerId: null, status: 'PENDING_REVIEW' } });
    expect(await finds.reclaimStaleApproved(t, b!.id, cut)).toBe(false);
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

describe('PrismaOfferHuntFindRepository — envio real e reenvio', () => {
  it('findById/listByHunt trazem status do disparo, hora, grupo e sessão (só do tenant); claimResend é CAS', async () => {
    const t = await tenant('delivery');
    const h = (await hunts.createWithinLimit(def(t), 5))!;
    const s = await prisma.session.create({ data: { tenantId: t, name: 'Loja' } });
    const g = await prisma.chatConversation.create({ data: { tenantId: t, sessionId: s.id, isGroup: true, groupJid: '9', groupName: 'Ofertas VIP', externalChatId: '9@g.us' } });
    const offer = await prisma.offer.create({ data: { tenantId: t, provider: 'SHEIN', sourceUrl: 'https://x', affiliateUrl: 'https://y', text: 't', origin: 'HUNTER' } });
    const [f] = await finds.insertWithinDailyLimit(t, [find('7001', h.id)], { since: SINCE, limit: 10 });
    expect(f!.delivery).toBeNull();
    await prisma.offerHuntFind.update({ where: { id: f!.id }, data: { status: 'SENT', offerId: offer.id } });
    await prisma.offerDispatch.create({ data: { tenantId: t, offerId: offer.id, conversationId: g.id, sessionId: s.id, status: 'QUEUED', notBefore: new Date() } });
    expect((await finds.findById(t, f!.id))!.delivery).toEqual({ dispatchStatus: 'QUEUED', sentAt: null, groupName: 'Ofertas VIP', sessionName: 'Loja', failureReason: null, updatedAt: expect.any(Date) });
    await prisma.offerDispatch.updateMany({ where: { offerId: offer.id }, data: { status: 'SENT' } });
    const [listed] = await finds.listByHunt(t, h.id, { limit: 5 });
    expect(listed!.delivery).toMatchObject({ dispatchStatus: 'SENT', sentAt: expect.any(Date) });
    expect(await finds.findById('other-tenant', f!.id)).toBeNull();

    const now = new Date('2026-11-12T12:00:00.000Z');
    const DAY = new Date('2026-11-12T03:00:00.000Z');
    const opts = { cooldownMs: 60_000, inFlightMs: 120_000, dayStart: DAY, dailyMax: 10 };
    await settings.upsert(t, s.id, g.id);
    const r = await Promise.all([finds.claimResend(t, f!.id, offer.id, now, opts), findsB.claimResend(t, f!.id, offer.id, now, opts)]);
    expect(r.map((x) => x.kind).sort()).toEqual(['CLAIMED', 'PENDING']);
    // Em voo: 2º clique 61 s depois (fora do cooldown) segue recusado
    expect(await finds.claimResend(t, f!.id, offer.id, new Date(now.getTime() + 61_000), opts)).toEqual({ kind: 'PENDING' });
    expect(await finds.claimResend(t, f!.id, 'outra-oferta', new Date(now.getTime() + 300_000), opts)).toEqual({ kind: 'PENDING' });
    // Em voo vencido sem troca da oferta: retoma o MESMO número e não conta de novo no dia
    const later = new Date(now.getTime() + 300_000);
    expect(await finds.claimResend(t, f!.id, offer.id, later, opts)).toEqual({ kind: 'CLAIMED', number: 1 });
    expect(await finds.countResendsInDay(t, DAY)).toBe(1);
    const offer2 = await prisma.offer.create({ data: { tenantId: t, provider: 'SHEIN', sourceUrl: 'https://x', affiliateUrl: 'https://y', text: 't', origin: 'HUNTER' } });
    await finds.recordResend(t, f!.id, offer2.id, 1);
    await finds.recordResend(t, f!.id, offer2.id, 1); // idempotente
    expect(await finds.findById(t, f!.id)).toMatchObject({ offerId: offer2.id, status: 'SENT', resendCount: 1, lastResentAt: later, resendInFlightUntil: null, delivery: null });
    expect(await finds.countResendsInDay(t, new Date(DAY.getTime() + 86_400_000))).toBe(0);
  });

  it('teto diário de reenvios por tenant: concorrência não estoura; dia novo zera; release mantém o número', async () => {
    const t = await tenant('resend-cap');
    const h = (await hunts.createWithinLimit(def(t), 5))!;
    const s = await prisma.session.create({ data: { tenantId: t, name: 'Loja' } });
    const g = await prisma.chatConversation.create({ data: { tenantId: t, sessionId: s.id, isGroup: true, groupJid: '8', externalChatId: '8@g.us' } });
    await settings.upsert(t, s.id, g.id);
    const offer = await prisma.offer.create({ data: { tenantId: t, provider: 'SHEIN', sourceUrl: 'https://x', affiliateUrl: 'https://y', text: 't', origin: 'HUNTER' } });
    const rows = await finds.insertWithinDailyLimit(t, ['8001', '8002', '8003', '8004'].map((id) => find(id, h.id)), { since: SINCE, limit: 10 });
    await prisma.offerHuntFind.updateMany({ where: { tenantId: t }, data: { status: 'SENT', offerId: offer.id } });
    const DAY = new Date('2026-11-12T03:00:00.000Z');
    const now = new Date('2026-11-12T12:00:00.000Z');
    const opts = { cooldownMs: 60_000, inFlightMs: 120_000, dayStart: DAY, dailyMax: 3 };
    const out = await Promise.all(rows.map((f, i) => (i % 2 ? findsB : finds).claimResend(t, f.id, offer.id, now, opts)));
    expect(out.filter((x) => x.kind === 'CLAIMED')).toHaveLength(3);
    expect(out.filter((x) => x.kind === 'DAILY_LIMIT')).toHaveLength(1);
    expect(await finds.countResendsInDay(t, DAY)).toBe(3);
    const claimed = rows[out.findIndex((x) => x.kind === 'CLAIMED')]!;
    await finds.releaseResend(t, claimed.id, 1, now);
    expect(await finds.claimResend(t, claimed.id, offer.id, new Date(now.getTime() + 1000), opts)).toEqual({ kind: 'CLAIMED', number: 1 });
    const loser = rows[out.findIndex((x) => x.kind === 'DAILY_LIMIT')]!;
    const tomorrow = { ...opts, dayStart: new Date(DAY.getTime() + 86_400_000) };
    expect(await finds.claimResend(t, loser.id, offer.id, new Date(now.getTime() + 86_400_000), tomorrow)).toEqual({ kind: 'CLAIMED', number: 1 });
    expect(await finds.countResendsInDay(t, tomorrow.dayStart)).toBe(1);
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
    const counters = { seenCount: 30, matchedCount: 5, chosenCount: 2, sentCount: 0, aiUsed: true, aiFallback: false, rejectedBy: { minSales: 21, repeated: 2 },
      ranking: [{ ...RANK_ITEM }] };
    await runs.finish(t, first.id, { ...counters, status: 'SUCCEEDED', errorCode: null, finishedAt: new Date() });
    await runs.finish(t, first.id, { ...counters, status: 'FAILED', errorCode: 'X', finishedAt: new Date() });
    await runs.incrementSent(t, first.id);
    expect(await prisma.offerHuntRun.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: 'SUCCEEDED', seenCount: 30, sentCount: 1 });
    // rejectedBy: JSON gravado e lido pelo mapper; execução pulada fica null
    const listed = await runs.listByHunt(t, h.id, { limit: 10 });
    expect(listed.find((x) => x.id === first.id)!.rejectedBy).toEqual({ minSales: 21, repeated: 2 });
    // Lista sem a coluna ranking (só hasRanking); detalhe traz o ranking, só da caçada/tenant
    expect(listed.every((x) => !('ranking' in x))).toBe(true);
    expect(listed.find((x) => x.id === first.id)!.hasRanking).toBe(true);
    expect(listed.find((x) => x.status === 'SKIPPED')!.hasRanking).toBe(false);
    expect((await runs.findById(t, h.id, first.id))!.ranking).toEqual([RANK_ITEM]);
    expect((await runs.findById(t, h.id, listed.find((x) => x.status === 'SKIPPED')!.id))!.ranking).toBeNull();
    expect(await runs.findById('other-tenant', h.id, first.id)).toBeNull();
    expect(await runs.findById(t, 'other-hunt', first.id)).toBeNull();
    expect(listed.find((x) => x.status === 'SKIPPED')!.rejectedBy).toBeNull();
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
