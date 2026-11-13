import { describe, expect, it, vi } from 'vitest';
import { RunOfferHuntUseCase, type RunOfferHuntInput } from './RunOfferHuntUseCase';
import { HuntFindDelivery } from '../../services/hunter/HuntFindDelivery';
import { EnqueueOfferUseCase } from '../EnqueueOfferUseCase';
import { FakeEntitlementReader, InMemoryOfferDispatchRepository, InMemoryOfferGeneratorConfigRepository, InMemoryOfferRepository } from '../offerTestFakes';
import {
  AT_TOKEN, FakeCatalog, FakeCredentials, FakeRanker, FakeRiskGate, HUNT, InMemoryFinds, InMemoryHunts, InMemoryRuns,
  InMemorySettings, MAX_ENTITLEMENTS, NOW, TENANT, makeHunt,
} from './hunterTestFakes';
import { huntCandidate } from '../../../domain/services/hunter/huntTestFixtures';
import type { OfferHunt } from '../../../domain/hunter/OfferHunt';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { AffiliateApiUnavailableError, AffiliateCredentialRejectedError } from '../../../../../shared/errors/internal/OfferErrors';
import { logger } from '../../../../../shared/logger/logger';

const K = ENTITLEMENT_KEYS;

function setup(opts: { hunt?: Partial<OfferHunt>; ent?: Record<string, unknown>; ranker?: FakeRanker } = {}) {
  const hunts = new InMemoryHunts([makeHunt(opts.hunt)]);
  const runs = new InMemoryRuns();
  const finds = new InMemoryFinds();
  const settings = new InMemorySettings();
  const catalog = new FakeCatalog();
  const credentials = new FakeCredentials();
  const riskGate = new FakeRiskGate();
  const entitlements = new FakeEntitlementReader({ ...MAX_ENTITLEMENTS, ...opts.ent });
  const ranker = opts.ranker ?? new FakeRanker();
  const offers = new InMemoryOfferRepository();
  const dispatches = new InMemoryOfferDispatchRepository(offers);
  const resolveCalls: unknown[][] = [];
  const delivery = new HuntFindDelivery({
    finds, runs, settings,
    affiliateProducts: {
      execute: vi.fn(async (...args: unknown[]) => {
        resolveCalls.push(args);
        const goodsId = String(args[1]).match(/-p-(\d+)\.html$/)![1];
        return {
          provider: 'SHEIN' as const, sourceUrl: String(args[1]), affiliateUrl: `https://onelink.shein.com/1/t${goodsId}`,
          attributionVerified: true, linkRebuilt: true,
          product: { productRef: goodsId, title: 'Vestido', priceCents: 5990, originalPriceCents: 9990, imageSourceUrl: null },
        };
      }),
    },
    texts: { compose: async (i) => ({ text: `${i.title} ${i.affiliateUrl}`, aiFallback: false }) },
    images: { storeImage: async () => null, discardImage: async () => {} },
    enqueue: new EnqueueOfferUseCase({ offers, dispatches, rand: () => 0 }),
    configs: new InMemoryOfferGeneratorConfigRepository(),
    now: () => NOW,
  });
  const sleeps: number[] = [];
  const uc = new RunOfferHuntUseCase({
    hunts, runs, finds, catalog, credentials, entitlements, riskGate, ranker, delivery,
    sleep: async (ms) => { sleeps.push(ms); }, rand: () => 0.5,
  });
  const run = (patch: Partial<RunOfferHuntInput> = {}) => uc.execute({ tenantId: TENANT, huntId: HUNT, trigger: 'MANUAL', now: NOW, ...patch });
  return { uc, run, hunts, runs, finds, settings, catalog, credentials, riskGate, entitlements, ranker, offers, sleeps, resolveCalls };
}

const items = (...ids: string[]) => ids.map((goodsId, i) => huntCandidate({ goodsId, commissionNewCents: 1000 - i * 100 }));

describe('RunOfferHuntUseCase — portões (HUNT-12)', () => {
  const gates: [string, (s: ReturnType<typeof setup>) => void, string, string | null][] = [
    ['plano Shein', (s) => { s.entitlements.values[K.MARKETPLACE_SHEIN_ENABLED] = false; }, 'PLAN_FEATURE_UNAVAILABLE', 'PLAN_UNAVAILABLE'],
    ['caçador fora do plano', (s) => { delete s.entitlements.values[K.OFFER_HUNTER_ENABLED]; }, 'PLAN_FEATURE_UNAVAILABLE', 'PLAN_UNAVAILABLE'],
    ['sem credencial', (s) => { s.credentials.state = { state: 'missing' }; }, 'AFFILIATE_CREDENTIAL_REQUIRED', null],
    ['credencial recusada', (s) => { s.credentials.state = { state: 'rejected', since: NOW, code: 'X' }; }, 'AFFILIATE_CREDENTIAL_REJECTED', 'CREDENTIAL_REJECTED'],
    ['credencial sem AT', (s) => {
      s.credentials.state = { state: 'ok', cred: { provider: 'SHEIN', publicIdentifier: 'm', secret: null, session: { cookies: {} } } };
    }, 'AFFILIATE_CREDENTIAL_REQUIRED', null],
    ['aceite do caçador', (s) => { s.riskGate.accepted = false; }, 'MARKETPLACE_RISK_NOT_ACCEPTED', 'RISK_NOT_ACCEPTED'],
    ['teto ausente = 0', (s) => { delete s.entitlements.values[K.OFFER_HUNTER_FINDS_PER_DAY]; }, 'OFFER_HUNT_DAILY_LIMIT', null],
  ];

  for (const [name, arrange, code] of gates) {
    it(`manual: ${name} → ${code}, sem chamar a Shein`, async () => {
      const s = setup();
      arrange(s);
      await expect(s.run()).rejects.toMatchObject({ code });
      expect(s.catalog.calls).toHaveLength(0);
      expect(s.runs.items).toHaveLength(0);
    });
  }

  for (const [name, arrange, code, pause] of gates) {
    it(`agendada: ${name} → SKIPPED ${code}${pause ? ` e pausa ${pause}` : ''}`, async () => {
      const s = setup();
      arrange(s);
      const out = await s.run({ trigger: 'SCHEDULED' });
      expect(out).toMatchObject({ status: 'SKIPPED', errorCode: code, pausedReason: pause });
      expect(s.runs.items).toMatchObject([{ status: 'SKIPPED', errorCode: code }]);
      expect(s.hunts.items[0]!.pauseReason).toBe(pause);
      expect(s.catalog.calls).toHaveLength(0);
    });
  }

  it('ordem: plano antes de credencial, credencial antes do aceite, aceite antes do teto', async () => {
    const s = setup({ ent: { [K.MARKETPLACE_SHEIN_ENABLED]: false } });
    s.credentials.state = { state: 'missing' };
    await expect(s.run()).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: K.MARKETPLACE_SHEIN_ENABLED } });
    expect(s.credentials.resolveCalls).toBe(0);

    const t = setup({ ent: { [K.OFFER_HUNTER_FINDS_PER_DAY]: 0 } });
    t.credentials.state = { state: 'missing' };
    t.riskGate.accepted = false;
    await expect(t.run()).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REQUIRED' });
    expect(t.riskGate.calls).toHaveLength(0);

    const u = setup({ ent: { [K.OFFER_HUNTER_FINDS_PER_DAY]: 0 } });
    u.riskGate.accepted = false;
    await expect(u.run()).rejects.toMatchObject({ code: 'MARKETPLACE_RISK_NOT_ACCEPTED', meta: { scope: 'OFFER_HUNTER' } });
    expect(u.riskGate.calls[0]).toEqual([TENANT, 'SHEIN', 'OFFER_HUNTER']);
  });

  it('teto do dia consumido (10 de 10) → 429 sem chamar a Shein', async () => {
    const s = setup();
    for (let i = 0; i < 10; i++) s.finds.seed({ goodsId: `9${i}000` });
    await expect(s.run()).rejects.toMatchObject({ code: 'OFFER_HUNT_DAILY_LIMIT', statusCode: 429 });
    expect(s.catalog.calls).toHaveLength(0);
  });

  it('guarda de 24 execuções/dia → OFFER_HUNT_RUN_THROTTLED sem chamar a Shein; SKIPPED não conta', async () => {
    const s = setup();
    for (let i = 0; i < 24; i++) await s.runs.createSkipped({ tenantId: TENANT, huntId: HUNT, trigger: 'SCHEDULED', startedAt: NOW, errorCode: 'X' });
    await s.run();
    for (let i = 0; i < 23; i++) await s.runs.startWithinDailyLimit({ tenantId: TENANT, huntId: HUNT, trigger: 'MANUAL', startedAt: NOW }, { since: NOW, limit: 99 });
    const calls = s.catalog.calls.length;
    await expect(s.run()).rejects.toMatchObject({ code: 'OFFER_HUNT_RUN_THROTTLED', statusCode: 429 });
    expect(s.catalog.calls).toHaveLength(calls);
    expect((await s.run({ trigger: 'SCHEDULED' })).errorCode).toBe('OFFER_HUNT_RUN_THROTTLED');
  });

  it('AUTO sem destino → OFFER_HUNT_DESTINATION_REQUIRED sem chamar a Shein', async () => {
    const s = setup({ hunt: { deliveryMode: 'AUTO' } });
    await expect(s.run()).rejects.toMatchObject({ code: 'OFFER_HUNT_DESTINATION_REQUIRED', statusCode: 422 });
    expect(s.catalog.calls).toHaveLength(0);
  });

  it('agendada com caçada pausada → SKIPPED, sem portões nem Shein', async () => {
    const s = setup({ hunt: { status: 'PAUSED', pauseReason: 'USER' } });
    expect(await s.run({ trigger: 'SCHEDULED' })).toMatchObject({ status: 'SKIPPED', errorCode: 'OFFER_HUNT_PAUSED' });
    expect(s.catalog.calls).toHaveLength(0);
  });

  it('caçada de outro tenant → OFFER_HUNT_NOT_FOUND', async () => {
    const s = setup();
    await expect(s.run({ tenantId: 'other' })).rejects.toMatchObject({ code: 'OFFER_HUNT_NOT_FOUND', statusCode: 404 });
  });
});

describe('RunOfferHuntUseCase — busca, seleção e gravação', () => {
  it('REVIEW: pontua, escolhe topN e grava PENDING_REVIEW com contadores', async () => {
    const s = setup();
    s.catalog.pages = [{ items: items('1001', '1002', '1003', '1004'), hasNextPage: false, total: 4 }];
    const out = await s.run();
    expect(out).toMatchObject({ status: 'SUCCEEDED', seenCount: 4, matchedCount: 4, chosenCount: 3, sentCount: 0, remainingToday: 7 });
    expect(out.finds.map((f) => f.goodsId)).toEqual(['1001', '1002', '1003']);
    expect(out.finds.every((f) => f.status === 'PENDING_REVIEW' && f.runId === out.runId)).toBe(true);
    expect(out.finds.every((f) => f.imageUrl === 'https://img.ltwebstatic.com/v4/j/spmp/x.jpg')).toBe(true);
    expect(out.ranking.map((r) => r.chosen)).toEqual([true, true, true, false]);
    expect(s.runs.items[0]).toMatchObject({ status: 'SUCCEEDED', seenCount: 4, chosenCount: 3 });
    expect(s.hunts.items[0]).toMatchObject({ lastRunAt: NOW, consecutiveFailures: 0 });
    expect(s.offers.items).toHaveLength(0);
  });

  it('saldo parcial: restam 2, topN 5 → grava 2', async () => {
    const s = setup({ hunt: { topN: 5 } });
    for (let i = 0; i < 8; i++) s.finds.seed({ goodsId: `9${i}000`, huntId: 'other-hunt' });
    s.catalog.pages = [{ items: items('1001', '1002', '1003', '1004', '1005', '1006'), hasNextPage: false, total: 6 }];
    const out = await s.run();
    expect(out.chosenCount).toBe(2);
    expect(out.remainingToday).toBe(0);
    expect(s.finds.items).toHaveLength(10);
  });

  it('até 3 páginas com pausa de 1–2 s entre elas', async () => {
    const s = setup();
    s.catalog.pages = [1, 2, 3, 4].map((p) => ({ items: items(`${p}001`, `${p}002`), hasNextPage: true, total: 99 }));
    const out = await s.run();
    expect(s.catalog.calls.filter((c) => c.method === 'list').map((c) => (c.query as { page: number }).page)).toEqual([1, 2, 3]);
    expect(s.sleeps).toHaveLength(2);
    expect(s.sleeps.every((ms) => ms >= 1000 && ms <= 2000)).toBe(true);
    expect(out.seenCount).toBe(6);
  });

  it('para em hasNextPage = false; palavra-chave usa search; faixa antiga gravada é ignorada (filtra recompra)', async () => {
    const s = setup({ hunt: { keyword: 'vestido', commissionBand: 'ABOVE_15', categoryId: '4436' } });
    s.catalog.pages = [{ items: items('1001'), hasNextPage: false, total: 1 }];
    await s.run();
    expect(s.catalog.calls.map((c) => c.method)).toEqual(['listCategories', 'search']);
    expect(s.catalog.calls[1]!.query).toMatchObject({ page: 1, keyword: 'vestido', category: { categoryId: '4436', name: 'Women Apparel' } });
    expect(s.sleeps).toHaveLength(0);
  });

  it('sem categoria nem faixa: did do "All"', async () => {
    const s = setup();
    await s.run();
    expect(s.catalog.calls.find((c) => c.method === 'list')!.query).toMatchObject({ did: 100, category: null });
  });

  it('filtros locais e repetição: escolhido nos últimos X dias não volta; mais antigo volta', async () => {
    const s = setup({ hunt: { filters: { minCommissionCents: 750 }, repeatAfterDays: 7 } });
    s.finds.seed({ goodsId: '1001', createdAt: new Date(NOW.getTime() - 2 * 86_400_000) });
    s.finds.seed({ goodsId: '1002', createdAt: new Date(NOW.getTime() - 8 * 86_400_000) });
    s.catalog.pages = [{ items: items('1001', '1002', '1003', '1004'), hasNextPage: false, total: 4 }];
    const out = await s.run();
    expect(out.matchedCount).toBe(3); // 1004 tem 700 de comissão
    expect(out.finds.map((f) => f.goodsId)).toEqual(['1002', '1003']);
  });

  it('rejectedBy: conta cada filtro que barrou (todas as chaves) e os repetidos; grava na execução', async () => {
    const s = setup({ hunt: { filters: { minSales: 301, minReviews: 1001, minRating: 4.5 }, repeatAfterDays: 7 } });
    s.finds.seed({ goodsId: '1001', createdAt: new Date(NOW.getTime() - 86_400_000) });
    s.catalog.pages = [{
      items: [
        huntCandidate({ goodsId: '1001', sales: 1000, reviews: 2000 }),
        huntCandidate({ goodsId: '1002', sales: 1000, reviews: 2000 }),
        huntCandidate({ goodsId: '1003', sales: 100, reviews: 2000, rating: null }),
        huntCandidate({ goodsId: '1004', sales: 100, reviews: 10 }),
      ],
      hasNextPage: false, total: 4,
    }];
    const out = await s.run();
    expect(out.matchedCount).toBe(2);
    expect(out.rejectedBy).toEqual({ minSales: 2, minReviews: 1, minRating: 1, repeated: 1 });
    expect(s.runs.items[0]!.rejectedBy).toEqual(out.rejectedBy);
    // Ranking gravado na execução = o devolvido, com comissões 1ª compra/recompra e marca de escolhido
    expect(s.runs.items[0]!.ranking).toEqual(out.ranking);
    expect(out.ranking.map((r) => [r.goodsId, r.chosen])).toEqual([['1002', true]]);
    expect(out.ranking[0]).toMatchObject({ salesBucket: 1000, reviewsBucket: 2000, commissionPercent: expect.any(Number), returningCommissionPercent: expect.any(Number) });
    expect(JSON.stringify(s.runs.items[0]!.ranking)).not.toContain('SECRET');
  });

  it('rejectedBy null quando a execução não chega à fonte', async () => {
    const s = setup({ hunt: { status: 'PAUSED' } });
    expect((await s.run({ trigger: 'SCHEDULED' })).rejectedBy).toBeNull();
  });

  it('duas execuções simultâneas da mesma caçada não gravam o mesmo item (repetição rechecada na gravação)', async () => {
    const s = setup();
    s.catalog.pages = [{ items: items('1001', '1002', '1003', '1004'), hasNextPage: false, total: 4 }];
    const [a, b] = await Promise.all([s.run(), s.run({ trigger: 'SCHEDULED' })]);
    const ids = s.finds.items.map((f) => f.goodsId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(a.chosenCount + b.chosenCount).toBe(ids.length);
  });

  it('IA ok: reordena o top e grava o motivo; recebe no máx. 15 e topN = min(topN, saldo)', async () => {
    const ranker = new FakeRanker([{ goodsId: '2030', reason: 'Melhor custo' }, { goodsId: '2010', reason: 'Vende muito' }]);
    const s = setup({ hunt: { aiEnabled: true }, ranker });
    s.catalog.pages = [{ items: items(...Array.from({ length: 10 }, (_, i) => `20${i}0`)), hasNextPage: true, total: 99 },
      { items: items(...Array.from({ length: 10 }, (_, i) => `30${i}0`)), hasNextPage: false, total: 99 }];
    const out = await s.run();
    expect(ranker.inputs[0]!.candidates).toHaveLength(15);
    expect(ranker.inputs[0]!.topN).toBe(3);
    expect(out).toMatchObject({ aiUsed: true, aiFallback: false });
    expect(out.finds.map((f) => [f.goodsId, f.aiReason])).toEqual([['2030', 'Melhor custo'], ['2010', 'Vende muito'], ['2000', null]]);
    expect(s.runs.items[0]).toMatchObject({ aiUsed: true, aiFallback: false });
  });

  it('IA null → aiFallback e ordem determinística', async () => {
    const s = setup({ hunt: { aiEnabled: true }, ranker: new FakeRanker(null) });
    s.catalog.pages = [{ items: items('1001', '1002', '1003', '1004'), hasNextPage: false, total: 4 }];
    const out = await s.run();
    expect(out).toMatchObject({ aiUsed: false, aiFallback: true, status: 'SUCCEEDED' });
    expect(out.finds.map((f) => f.goodsId)).toEqual(['1001', '1002', '1003']);
  });

  it('IA desligada não chama o ranker', async () => {
    const s = setup();
    await s.run();
    expect(s.ranker.inputs).toHaveLength(0);
  });
});

describe('RunOfferHuntUseCase — falhas da fonte', () => {
  it('fonte indisponível: +1 falha; na 3ª seguida pausa SOURCE_UNAVAILABLE; manual responde 503', async () => {
    const s = setup({ hunt: { consecutiveFailures: 1 } });
    s.catalog.error = new AffiliateApiUnavailableError('SHEIN');
    await expect(s.run()).rejects.toMatchObject({ code: 'OFFER_HUNT_SOURCE_UNAVAILABLE', statusCode: 503, meta: { paused: false } });
    expect(s.hunts.items[0]).toMatchObject({ consecutiveFailures: 2, status: 'ACTIVE' });
    const out = await s.run({ trigger: 'SCHEDULED' });
    expect(out).toMatchObject({ status: 'FAILED', errorCode: 'AFFILIATE_API_UNAVAILABLE', pausedReason: 'SOURCE_UNAVAILABLE' });
    expect(s.hunts.items[0]).toMatchObject({ consecutiveFailures: 3, status: 'PAUSED', pauseReason: 'SOURCE_UNAVAILABLE' });
    expect(s.runs.items.map((r) => r.status)).toEqual(['FAILED', 'FAILED']);
  });

  it('sucesso zera as falhas seguidas', async () => {
    const s = setup({ hunt: { consecutiveFailures: 2 } });
    await s.run();
    expect(s.hunts.items[0]!.consecutiveFailures).toBe(0);
  });

  it('credencial recusada pela Shein: marca rejected, pausa CREDENTIAL_REJECTED e fecha a execução', async () => {
    const s = setup();
    s.catalog.error = new AffiliateCredentialRejectedError('SHEIN');
    await expect(s.run()).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
    expect(s.credentials.rejected).toEqual(['AFFILIATE_CREDENTIAL_REJECTED']);
    expect(s.hunts.items[0]).toMatchObject({ status: 'PAUSED', pauseReason: 'CREDENTIAL_REJECTED' });
    expect(s.runs.items[0]).toMatchObject({ status: 'FAILED', errorCode: 'AFFILIATE_CREDENTIAL_REJECTED' });
  });
});

describe('RunOfferHuntUseCase — AUTO e segredo', () => {
  it('AUTO entrega pelo Enqueue com origin HUNTER, sourceKey hunt:<findId> e riskScope OFFER_HUNTER', async () => {
    const s = setup({ hunt: { deliveryMode: 'AUTO', topN: 2 } });
    await s.settings.upsert(TENANT, 'session-1', 'conv-1');
    s.catalog.pages = [{ items: items('1001', '1002', '1003'), hasNextPage: false, total: 3 }];
    const out = await s.run();
    expect(s.finds.items.map((f) => f.failureReason)).toEqual([null, null]);
    expect(out).toMatchObject({ chosenCount: 2, sentCount: 2 });
    expect(s.offers.items.map((o) => [o.origin, o.sourceKey, o.affiliateUrl])).toEqual([
      ['HUNTER', `hunt:${out.finds[0]!.id}`, 'https://onelink.shein.com/1/t1001'],
      ['HUNTER', `hunt:${out.finds[1]!.id}`, 'https://onelink.shein.com/1/t1002'],
    ]);
    expect(s.resolveCalls[0]).toEqual([TENANT, 'https://br.shein.com/product-p-1001.html', { riskScope: 'OFFER_HUNTER' }]);
    expect(s.finds.items.map((f) => [f.status, f.offerId])).toEqual([['SENT', s.offers.items[0]!.id], ['SENT', s.offers.items[1]!.id]]);
    expect(s.runs.items[0]).toMatchObject({ sentCount: 2, chosenCount: 2 });
  });

  it('o token AT só vai ao cliente do catálogo: nunca em saída, execução, achado, erro ou log', async () => {
    const spies = (['info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(logger, m));
    const s = setup({ hunt: { deliveryMode: 'AUTO', aiEnabled: true }, ranker: new FakeRanker(null) });
    await s.settings.upsert(TENANT, 'session-1', 'conv-1');
    s.catalog.pages = [{ items: items('1001', '1002'), hasNextPage: false, total: 2 }];
    const ok = await s.run();
    expect(s.catalog.calls[0]!.session).toEqual({ token: AT_TOKEN, memberId: 'member-9' });
    s.catalog.error = new AffiliateApiUnavailableError('SHEIN');
    const err = await s.run().catch((e: unknown) => e);
    const failed = await s.run({ trigger: 'SCHEDULED' });
    const dump = JSON.stringify([ok, failed, s.runs.items, s.finds.items, s.offers.items, s.ranker.inputs, err, (err as Error).message,
      spies.map((sp) => sp.mock.calls)]);
    expect(dump).not.toContain(AT_TOKEN);
  });
});
