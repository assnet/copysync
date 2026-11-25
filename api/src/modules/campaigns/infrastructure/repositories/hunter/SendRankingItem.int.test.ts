import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../../../../shared/database/prisma.client';
import { PrismaOfferHuntRepository } from './PrismaOfferHuntRepository';
import { PrismaOfferHuntRunRepository } from './PrismaOfferHuntRunRepository';
import { PrismaOfferHuntFindRepository } from './PrismaOfferHuntFindRepository';
import { SendRankingItemUseCase } from '../../../application/use-cases/hunter/SendRankingItemUseCase';
import { FakeCatalog, FakeCredentials, FakeRiskGate, MAX_ENTITLEMENTS, testProviders } from '../../../application/use-cases/hunter/hunterTestFakes';
import { FakeEntitlementReader } from '../../../application/use-cases/offerTestFakes';
import type { OfferHuntFind, OfferHuntRankingItem } from '../../../domain/hunter/OfferHunt';
import type { CreateOfferHuntInput } from '../../../domain/contracts/hunter/IOfferHuntRepository';

/** Reaproveitamento do ranking: dois pedidos simultâneos (dois pools = dois processos) do mesmo item → 1 entrega. */
const other = new PrismaClient({ datasources: { db: { url: process.env['DATABASE_URL']! } } });
const stamp = Date.now();
const tenants: string[] = [];

const item = (productId: string): OfferHuntRankingItem => ({
  provider: 'SHEIN', productId, commissionEstimated: false, title: 'Vestido', imageUrl: 'https://img.ltwebstatic.com/a.jpg', priceCents: 5990,
  discountPercent: 40, commissionPercent: 15.5, commissionCents: 928, returningCommissionPercent: null, returningCommissionCents: null,
  extraCommissionCents: 0, salesBucket: 1000, reviewsBucket: 500, rating: 4.8, score: 81.5,
  factors: [{ key: 'commission', points: 30, max: 40 }], aiReason: 'bom preço', chosen: false,
});

const def = (tenantId: string): CreateOfferHuntInput => ({
  tenantId, provider: 'SHEIN', name: 'Rank', sort: 'BEST_SELLING', categoryId: null, commissionBand: null, keyword: null,
  sourceOptions: null, filters: {}, aiEnabled: false, aiConfigured: false, aiIntent: null, topN: 1, repeatAfterDays: 7,
  deliveryMode: 'REVIEW', intervalMinutes: 60, windowStartMinute: 0, windowEndMinute: 1440, weekdaysMask: 127, nextRunAt: null,
});

/** Um caso de uso por "processo" (pool próprio); entrega falsa conta as ofertas (o Enqueue real é idempotente à parte). */
function useCase(client: PrismaClient, delivered: string[], fail = new Set<string>()) {
  const finds = new PrismaOfferHuntFindRepository(client);
  return new SendRankingItemUseCase({
    hunts: new PrismaOfferHuntRepository(client),
    runs: new PrismaOfferHuntRunRepository(client),
    finds,
    providers: testProviders(new FakeCatalog()),
    entitlements: new FakeEntitlementReader({ ...MAX_ENTITLEMENTS, offer_hunter_finds_per_day: 0 }),
    credentials: new FakeCredentials(),
    riskGate: new FakeRiskGate(),
    delivery: {
      requireDestination: async () => ({ sessionId: 's', conversationId: 'c' }),
      deliver: async (tenantId: string, f: OfferHuntFind) => {
        delivered.push(`hunt:${f.id}`);
        if (fail.has(f.productId)) {
          await finds.transition(tenantId, f.id, ['APPROVED'], 'FAILED', { failureReason: 'DELIVERY_FAILED' });
          return { status: 'FAILED' as const, reason: 'DELIVERY_FAILED', error: new Error('net') };
        }
        await finds.transition(tenantId, f.id, ['APPROVED'], 'SENT', { failureReason: null });
        return { status: 'SENT' as const, offerId: `offer-${delivered.length}` };
      },
    },
  });
}

beforeAll(async () => { await other.$connect(); });
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await other.$disconnect();
  await prisma.$disconnect();
});

async function seed(tag: string) {
  const tenantId = (await prisma.tenant.create({ data: { name: `int ${tag}`, slug: `int-rank-${tag}-${stamp}` } })).id;
  tenants.push(tenantId);
  const runs = new PrismaOfferHuntRunRepository(prisma);
  const hunt = (await new PrismaOfferHuntRepository(prisma).createWithinLimit(def(tenantId), 5))!;
  const startedAt = new Date(Date.now() - 3_600_000);
  const run = (await runs.startWithinDailyLimit({ tenantId, huntId: hunt.id, provider: 'SHEIN', trigger: 'MANUAL', startedAt }, { since: new Date(0), limit: 24 }))!;
  await runs.finish(tenantId, run.id, {
    seenCount: 3, matchedCount: 3, chosenCount: 0, sentCount: 0, aiUsed: false, aiFallback: false, rejectedBy: {},
    ranking: [item('20000001'), item('20000002')], status: 'SUCCEEDED', errorCode: null, finishedAt: startedAt,
  });
  return { tenantId, huntId: hunt.id, runId: run.id };
}

/** Achado de execução normal (insertWithinDailyLimit). */
const newFind = (huntId: string, productId = '20000002') => ({
  huntId, runId: null, status: 'PENDING_REVIEW' as const, provider: 'SHEIN' as const, productId, goodsId: productId,
  commissionEstimated: false, skcCode: null, activityId: null, title: 'x', imageUrl: null, priceCents: 1, originalPriceCents: null,
  discountPercent: null, commissionPercent: null, commissionCents: null, returningCommissionPercent: null, returningCommissionCents: null,
  extraCommissionCents: null, salesBucket: null, reviewsBucket: null, rating: null, score: 1, factors: [], aiReason: null,
});

describe('SendRankingItemUseCase + PrismaOfferHuntFindRepository.insertRankingFind', () => {
  it('dois pedidos simultâneos do mesmo item → 1 achado, 1 entrega; o outro 409 OFFER_HUNT_ALREADY_SENT', async () => {
    const { tenantId, huntId, runId } = await seed('race');
    const delivered: string[] = [];
    const input = { tenantId, huntId, runId, productId: '20000001', isSuperAdmin: false };
    const r = await Promise.allSettled([useCase(prisma, delivered).execute(input), useCase(other, delivered).execute(input)]);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'OFFER_HUNT_ALREADY_SENT' });
    const rows = await prisma.offerHuntFind.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(delivered).toEqual([`hunt:${rows[0]!.id}`]);
    expect(rows[0]).toMatchObject({ runId, huntId, productId: '20000001', status: 'SENT', aiReason: 'bom preço', fromRanking: true });
    expect(await new PrismaOfferHuntFindRepository(prisma).productIdsByRun(tenantId, runId)).toEqual(['20000001']);
  });

  it('repetido na janela da caçada (achado de outra execução) → ALREADY_SENT REPEATED; não conta no teto (teto 0)', async () => {
    const { tenantId, huntId, runId } = await seed('repeat');
    const finds = new PrismaOfferHuntFindRepository(prisma);
    const base = newFind(huntId);
    await finds.insertWithinDailyLimit(tenantId, [{ ...base, productId: '20000002' }], { since: new Date(0), limit: 10 });
    const delivered: string[] = [];
    await expect(useCase(prisma, delivered).execute({ tenantId, huntId, runId, productId: '20000002', isSuperAdmin: false }))
      .rejects.toMatchObject({ code: 'OFFER_HUNT_ALREADY_SENT', meta: { reason: 'REPEATED' } });
    await expect(useCase(prisma, delivered).execute({ tenantId, huntId, runId, productId: '20000001', isSuperAdmin: false })).resolves.toMatchObject({ status: 'SENT' });
    expect(delivered).toHaveLength(1);
  });

  it('teto 10 com 5 reaproveitados: uso do painel não sobe e a próxima execução grava o saldo cheio (10)', async () => {
    const { tenantId, huntId, runId } = await seed('quota');
    const finds = new PrismaOfferHuntFindRepository(prisma);
    for (let i = 0; i < 5; i++) {
      await finds.insertRankingFind(tenantId, { ...newFind(huntId, `3000000${i}`), runId, status: 'APPROVED' }, new Date(0));
    }
    expect(await finds.countCreatedSince(tenantId, new Date(0))).toBe(0);
    const next = Array.from({ length: 12 }, (_, i) => newFind(huntId, `400000${String(i).padStart(2, '0')}`));
    expect(await finds.insertWithinDailyLimit(tenantId, next, { since: new Date(0), limit: 10 })).toHaveLength(10);
    expect(await finds.countCreatedSince(tenantId, new Date(0))).toBe(10);
  });

  it('FAILED/DISMISSED da execução não é "enviado": fora do productIdsByRun e o item é reenviado (linha nova)', async () => {
    const { tenantId, huntId, runId } = await seed('failed');
    const finds = new PrismaOfferHuntFindRepository(prisma);
    const delivered: string[] = [];
    const input = { tenantId, huntId, runId, productId: '20000001', isSuperAdmin: false };
    await expect(useCase(prisma, delivered, new Set(['20000001'])).execute(input)).rejects.toMatchObject({ code: 'DELIVERY_FAILED' });
    expect(await finds.productIdsByRun(tenantId, runId)).toEqual([]);
    expect(await finds.recentProductIds(tenantId, huntId, 'SHEIN', new Date(0), { exceptUndeliveredInRun: runId })).toEqual(new Set());
    expect(await finds.recentProductIds(tenantId, huntId, 'SHEIN', new Date(0))).toEqual(new Set(['20000001']));
    await expect(useCase(prisma, delivered).execute(input)).resolves.toMatchObject({ status: 'SENT' });
    const rows = await prisma.offerHuntFind.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.status)).toEqual(['FAILED', 'SENT']);
    expect(delivered).toEqual(rows.map((r) => `hunt:${r.id}`));
    expect(await finds.productIdsByRun(tenantId, runId)).toEqual(['20000001']);
    await expect(useCase(prisma, delivered).execute(input)).rejects.toMatchObject({ code: 'OFFER_HUNT_ALREADY_SENT', meta: { reason: 'RUN' } });
  });
});
