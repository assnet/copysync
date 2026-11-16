import { describe, expect, it, vi } from 'vitest';
import { SendRankingItemUseCase } from './SendRankingItemUseCase';
import { SendRankingRemainderUseCase } from './SendRankingRemainderUseCase';
import { GetOfferHuntRunUseCase } from './OfferHuntHistoryUseCases';
import { ApproveHuntFindUseCase, HUNT_FIND_STALE_APPROVED_MS } from './HuntFindDecisionUseCases';
import { HuntFindDelivery } from '../../services/hunter/HuntFindDelivery';
import { EnqueueOfferUseCase } from '../EnqueueOfferUseCase';
import {
  FakeEntitlementReader, InMemoryOfferDispatchRepository, InMemoryOfferGeneratorConfigRepository, InMemoryOfferRepository,
} from '../offerTestFakes';
import {
  FakeCatalog, FakeCredentials, FakeRiskGate, HUNT, InMemoryFinds, InMemoryHunts, InMemoryRuns, InMemorySettings, MAX_ENTITLEMENTS, NOW, TENANT,
  makeHunt, testProviders,
} from './hunterTestFakes';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { AffiliateCredentialRejectedError } from '../../../../../shared/errors/internal/OfferErrors';
import type { OfferHuntRankingItem } from '../../../domain/hunter/OfferHunt';

const HOUR = 3_600_000;
/** Id Shein válido (8 dígitos) a partir de um apelido curto. */
const pid = (n: string) => `1000000${n}`;

const item = (productId: string, patch: Partial<OfferHuntRankingItem> = {}): OfferHuntRankingItem => ({
  provider: 'SHEIN', productId: pid(productId), title: `Produto ${productId}`, imageUrl: 'https://img.ltwebstatic.com/p.jpg', priceCents: 5990, discountPercent: 20,
  commissionPercent: 12, commissionCents: 700, returningCommissionPercent: 4, returningCommissionCents: 200, extraCommissionCents: 0,
  commissionEstimated: false, salesBucket: 100, reviewsBucket: 10, rating: 4.7, score: 70, factors: [{ key: 'commission', points: 30, max: 40 }],
  aiReason: `motivo ${productId}`, chosen: false, ...patch,
});

function setup(opts: { ent?: Record<string, unknown>; runAgeMs?: number; ranking?: OfferHuntRankingItem[] } = {}) {
  const hunts = new InMemoryHunts([makeHunt({ repeatAfterDays: 7 })]);
  const runs = new InMemoryRuns();
  const finds = new InMemoryFinds();
  const settings = new InMemorySettings();
  const offers = new InMemoryOfferRepository();
  const dispatches = new InMemoryOfferDispatchRepository(offers);
  const entitlements = new FakeEntitlementReader({ ...MAX_ENTITLEMENTS, ...opts.ent });
  const credentials = new FakeCredentials();
  const riskGate = new FakeRiskGate();
  const now = new Date(NOW.getTime() + (opts.runAgeMs ?? HOUR));
  finds.clock = () => now;
  const resolve = vi.fn(async (_t: string, url: string) => ({
    provider: 'SHEIN' as const, sourceUrl: url, affiliateUrl: 'https://onelink.shein.com/1/tenant', attributionVerified: true, linkRebuilt: true,
    product: { productRef: '1', title: null, priceCents: null, originalPriceCents: null, imageSourceUrl: null },
  }));
  const storeImage = vi.fn(async () => 'stored/p.jpg');
  const enqueue = new EnqueueOfferUseCase({ offers, dispatches, rand: () => 0 });
  const delivery = new HuntFindDelivery({
    finds, runs, settings,
    affiliateProducts: { execute: resolve },
    texts: { compose: async (i) => ({ text: `${i.title} ${i.affiliateUrl}`, aiFallback: false }) },
    images: { storeImage, discardImage: async () => {} },
    enqueue,
    configs: new InMemoryOfferGeneratorConfigRepository(),
    providers: testProviders(new FakeCatalog()),
    now: () => now,
  });
  const run = runs.seed({ ranking: opts.ranking ?? [item('1', { chosen: true }), item('2'), item('3'), item('4')] });
  const uc = new SendRankingItemUseCase({
    hunts, runs, finds, providers: testProviders(new FakeCatalog()), entitlements, credentials, riskGate, delivery, now: () => now,
  });
  const all = new SendRankingRemainderUseCase({ items: uc, finds, now: () => now });
  const input = (productId: string) => ({ tenantId: TENANT, huntId: HUNT, runId: run.id, productId: pid(productId) });
  return { hunts, runs, finds, settings, offers, entitlements, credentials, riskGate, resolve, storeImage, enqueue, uc, all, run, input, now, delivery };
}

const withDestination = async (s: ReturnType<typeof setup>) => { await s.settings.upsert(TENANT, 'session-1', 'conv-1'); return s; };

describe('SendRankingItemUseCase', () => {
  it('cria achado do item (runId, motivo da IA, foto do ranking) e entrega: HUNTER, sourceKey hunt:<findId>, sem gastar o teto', async () => {
    const s = await withDestination(setup({ ent: { [ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY]: 0 } }));
    const out = await s.uc.execute(s.input('2'));
    expect(out).toMatchObject({
      status: 'SENT', runId: s.run.id, huntId: HUNT, productId: pid('2'), title: 'Produto 2', aiReason: 'motivo 2', commissionCents: 700, rating: 4.7,
    });
    const offer = s.offers.items[0]!;
    expect(offer).toMatchObject({ origin: 'HUNTER', sourceKey: `hunt:${out.id}`, imageUrl: 'stored/p.jpg' });
    expect(out.fromRanking).toBe(true);
    expect(out.offerId).toBe(offer.id);
    expect(s.storeImage).toHaveBeenCalledWith('https://img.ltwebstatic.com/p.jpg');
    expect(s.resolve).toHaveBeenCalledWith(TENANT, expect.stringContaining(pid('2')), { riskScope: 'OFFER_HUNTER' });
    // Teto do dia = 0 e nada de execução nova
    expect(s.runs.items).toHaveLength(1);
  });

  it('já enviado desta execução (escolhido ou 2º clique) → 409 OFFER_HUNT_ALREADY_SENT, uma oferta só', async () => {
    const s = await withDestination(setup());
    s.finds.seed({ runId: s.run.id, productId: pid('1'), createdAt: new Date(0) });
    await expect(s.uc.execute(s.input('1'))).rejects.toMatchObject({ code: 'OFFER_HUNT_ALREADY_SENT', statusCode: 409, meta: { reason: 'RUN' } });
    await s.uc.execute(s.input('2'));
    await expect(s.uc.execute(s.input('2'))).rejects.toMatchObject({ code: 'OFFER_HUNT_ALREADY_SENT' });
    expect(s.offers.items).toHaveLength(1);
  });

  it('dois pedidos simultâneos do mesmo item → 1 oferta', async () => {
    const s = await withDestination(setup());
    const r = await Promise.allSettled([s.uc.execute(s.input('3')), s.uc.execute(s.input('3'))]);
    expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(s.offers.items).toHaveLength(1);
  });

  it('repetido na janela repeatAfterDays da caçada (outra execução) → 409 REPEATED; fora da janela envia', async () => {
    const s = await withDestination(setup());
    s.finds.seed({ productId: pid('2'), runId: 'other', createdAt: new Date(s.now.getTime() - 6 * 24 * HOUR) });
    await expect(s.uc.execute(s.input('2'))).rejects.toMatchObject({ code: 'OFFER_HUNT_ALREADY_SENT', meta: { reason: 'REPEATED' } });
    s.finds.seed({ productId: pid('3'), runId: 'other', createdAt: new Date(s.now.getTime() - 8 * 24 * HOUR) });
    await expect(s.uc.execute(s.input('3'))).resolves.toMatchObject({ status: 'SENT' });
  });

  it('execução com mais de 48 h → 409 OFFER_HUNT_RANKING_EXPIRED, sem achado', async () => {
    const s = await withDestination(setup({ runAgeMs: 48 * HOUR + 1 }));
    await expect(s.uc.execute(s.input('2'))).rejects.toMatchObject({ code: 'OFFER_HUNT_RANKING_EXPIRED', statusCode: 409 });
    expect(s.finds.items).toHaveLength(0);
  });

  it('48 h exatas ainda vale', async () => {
    const s = await withDestination(setup({ runAgeMs: 48 * HOUR }));
    await expect(s.uc.execute(s.input('2'))).resolves.toMatchObject({ status: 'SENT' });
  });

  it('404: caçada de outro tenant, execução inexistente, produto fora do ranking', async () => {
    const s = await withDestination(setup());
    await expect(s.uc.execute({ ...s.input('2'), tenantId: 'other' })).rejects.toMatchObject({ code: 'OFFER_HUNT_NOT_FOUND' });
    await expect(s.uc.execute({ ...s.input('2'), runId: 'run-x' })).rejects.toMatchObject({ code: 'OFFER_HUNT_NOT_FOUND' });
    await expect(s.uc.execute(s.input('999'))).rejects.toMatchObject({ code: 'OFFER_HUNT_NOT_FOUND' });
    expect(s.resolve).not.toHaveBeenCalled();
  });

  it.each([
    ['plano Shein', { ent: { [ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED]: false } }, 'PLAN_FEATURE_UNAVAILABLE'],
    ['caçador', { ent: { [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]: false } }, 'PLAN_FEATURE_UNAVAILABLE'],
  ])('portão %s → erro, sem achado nem loja', async (_n, opts, code) => {
    const s = await withDestination(setup(opts));
    await expect(s.uc.execute(s.input('2'))).rejects.toMatchObject({ code });
    expect(s.finds.items).toHaveLength(0);
    expect(s.resolve).not.toHaveBeenCalled();
  });

  it('credencial recusada / ausente e aceite pendente → erro do portão, sem achado', async () => {
    const s = await withDestination(setup());
    s.credentials.state = { state: 'rejected' } as never;
    await expect(s.uc.execute(s.input('2'))).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
    s.credentials.state = { state: 'missing' } as never;
    await expect(s.uc.execute(s.input('2'))).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REQUIRED' });
    s.credentials.state = new FakeCredentials().state;
    s.riskGate.accepted = false;
    await expect(s.uc.execute(s.input('2'))).rejects.toMatchObject({ code: 'MARKETPLACE_RISK_NOT_ACCEPTED' });
    expect(s.riskGate.calls.at(-1)).toEqual([TENANT, 'SHEIN', 'OFFER_HUNTER']);
    expect(s.finds.items).toHaveLength(0);
  });

  it('sem destino → 422 OFFER_HUNT_DESTINATION_REQUIRED, sem achado', async () => {
    const s = setup();
    await expect(s.uc.execute(s.input('2'))).rejects.toMatchObject({ code: 'OFFER_HUNT_DESTINATION_REQUIRED', statusCode: 422 });
    expect(s.finds.items).toHaveLength(0);
  });

  it('teto do dia: reaproveitados não contam (uso do painel e saldo da próxima execução)', async () => {
    const s = await withDestination(setup({ ranking: ['2', '3', '4', '5', '6'].map((n) => item(n)) }));
    expect((await s.all.execute({ tenantId: TENANT, huntId: HUNT, runId: s.run.id })).sent).toBe(5);
    expect(await s.finds.countCreatedSince(TENANT, new Date(0))).toBe(0);
    const fresh = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].map((n) => ({ ...s.finds.seed({ productId: `9${n}` }) }));
    s.finds.items = s.finds.items.filter((f) => f.fromRanking);
    const ins = await s.finds.insertWithinDailyLimit(TENANT, fresh.map((f) => ({ ...f, status: 'PENDING_REVIEW' as const })), { since: new Date(0), limit: 10 });
    expect(ins).toHaveLength(10);
  });

  it('retomada de reaproveitado APPROVED sem offerId (aprovar) usa a mesma chave: sem oferta duplicada', async () => {
    const s = await withDestination(setup());
    const sent = await s.uc.execute(s.input('2'));
    // Queda entre enfileirar e gravar o offerId: achado fica APPROVED sem oferta, preso
    Object.assign(s.finds.items[0]!, { status: 'APPROVED', offerId: null, updatedAt: new Date(s.now.getTime() - HUNT_FIND_STALE_APPROVED_MS - 1) });
    const approve = new ApproveHuntFindUseCase({ finds: s.finds, entitlements: s.entitlements, delivery: s.delivery, now: () => s.now });
    const out = await approve.execute({ tenantId: TENANT, findId: sent.id });
    expect(out.offerId).toBe(sent.offerId);
    expect(s.offers.items).toHaveLength(1);
  });

  it('reaproveitado não soma no sentCount da execução original', async () => {
    const s = await withDestination(setup());
    await s.uc.execute(s.input('2'));
    expect(s.runs.items[0]!.sentCount).toBe(0);
  });

  it('achado FAILED/DISMISSED da execução não conta como enviado: reenvio cria linha nova', async () => {
    const s = await withDestination(setup());
    s.resolve.mockRejectedValueOnce(new AffiliateCredentialRejectedError('SHEIN'));
    await expect(s.uc.execute(s.input('2'))).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
    s.finds.seed({ runId: s.run.id, productId: pid('3'), status: 'DISMISSED', createdAt: s.now });
    expect(await s.finds.productIdsByRun(TENANT, s.run.id)).toEqual([]);
    await expect(s.uc.execute(s.input('2'))).resolves.toMatchObject({ status: 'SENT' });
    await expect(s.uc.execute(s.input('3'))).resolves.toMatchObject({ status: 'SENT' });
    expect(s.finds.items.filter((f) => f.productId === pid('2')).map((f) => f.status)).toEqual(['FAILED', 'SENT']);
    expect(s.offers.items).toHaveLength(2);
  });

  it('erro cru na entrega (rede/banco) → AppError DELIVERY_FAILED, achado FAILED', async () => {
    const s = await withDestination(setup());
    s.resolve.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(s.uc.execute(s.input('2'))).rejects.toMatchObject({ code: 'DELIVERY_FAILED', statusCode: 502 });
    expect(s.finds.items[0]).toMatchObject({ status: 'FAILED', failureReason: 'DELIVERY_FAILED' });
  });

  it('loja recusa no Resolve → achado FAILED e o erro sobe', async () => {
    const s = await withDestination(setup());
    s.resolve.mockRejectedValueOnce(new AffiliateCredentialRejectedError('SHEIN'));
    await expect(s.uc.execute(s.input('2'))).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
    expect(s.finds.items[0]).toMatchObject({ status: 'FAILED', failureReason: 'AFFILIATE_CREDENTIAL_REJECTED' });
  });
});

describe('SendRankingRemainderUseCase', () => {
  it('envia os não escolhidos e não enviados em sequência; pula repetidos e os já enviados desta execução', async () => {
    const s = await withDestination(setup({ ranking: [item('1', { chosen: true }), item('2'), item('3'), item('4'), item('5')] }));
    s.finds.seed({ runId: s.run.id, productId: pid('3'), createdAt: s.now });
    s.finds.seed({ runId: 'other', productId: pid('4'), createdAt: s.now });
    const out = await s.all.execute({ tenantId: TENANT, huntId: HUNT, runId: s.run.id });
    expect(out).toEqual({ sent: 2, skipped: [{ productId: pid('4'), reason: 'REPEATED' }] });
    const sent = s.finds.items.filter((f) => f.fromRanking);
    expect(s.offers.items.map((o) => o.sourceKey)).toEqual(sent.map((f) => `hunt:${f.id}`));
    // De novo: nada a enviar (o repetido segue informado)
    expect(await s.all.execute({ tenantId: TENANT, huntId: HUNT, runId: s.run.id })).toEqual({ sent: 0, skipped: [{ productId: pid('4'), reason: 'REPEATED' }] });
    expect(s.offers.items).toHaveLength(2);
  });

  it('sem gastar o teto do dia (teto 0 não impede)', async () => {
    const s = await withDestination(setup({ ent: { [ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY]: 0 } }));
    expect((await s.all.execute({ tenantId: TENANT, huntId: HUNT, runId: s.run.id })).sent).toBe(3);
  });

  it('erro de portão no 1º item → o erro sobe, nada enviado', async () => {
    const s = await withDestination(setup());
    s.riskGate.accepted = false;
    await expect(s.all.execute({ tenantId: TENANT, huntId: HUNT, runId: s.run.id })).rejects.toMatchObject({ code: 'MARKETPLACE_RISK_NOT_ACCEPTED' });
    expect(s.offers.items).toHaveLength(0);
  });

  it('credencial recusada no meio → para e devolve o que já foi (item que parou em skipped)', async () => {
    const s = await withDestination(setup());
    s.resolve.mockImplementationOnce(async (_t, url) => ({
      provider: 'SHEIN' as const, sourceUrl: url, affiliateUrl: 'https://onelink.shein.com/1/tenant', attributionVerified: true, linkRebuilt: true,
      product: { productRef: '1', title: null, priceCents: null, originalPriceCents: null, imageSourceUrl: null },
    })).mockRejectedValueOnce(new AffiliateCredentialRejectedError('SHEIN'));
    const out = await s.all.execute({ tenantId: TENANT, huntId: HUNT, runId: s.run.id });
    expect(out).toEqual({ sent: 1, skipped: [{ productId: pid('3'), reason: 'AFFILIATE_CREDENTIAL_REJECTED' }] });
    expect(s.resolve).toHaveBeenCalledTimes(2);
  });

  it('reenvia o FAILED desta execução (não é REPEATED)', async () => {
    const s = await withDestination(setup({ ranking: [item('2')] }));
    s.finds.seed({ runId: s.run.id, productId: pid('2'), status: 'FAILED', fromRanking: true, createdAt: s.now });
    expect(await s.all.execute({ tenantId: TENANT, huntId: HUNT, runId: s.run.id })).toEqual({ sent: 1, skipped: [] });
  });

  it('erro não-AppError depois de enviar → para e devolve o feito com DELIVERY_FAILED; sem nada enviado sobe', async () => {
    const s = await withDestination(setup());
    const send = s.uc.send.bind(s.uc);
    let n = 0;
    const items = { loadContext: s.uc.loadContext.bind(s.uc), send: async (...a: Parameters<typeof send>) => { if (++n === 2) throw new Error('db down'); return send(...a); } };
    const all = new SendRankingRemainderUseCase({ items, finds: s.finds, now: () => s.now });
    expect(await all.execute({ tenantId: TENANT, huntId: HUNT, runId: s.run.id })).toEqual({ sent: 1, skipped: [{ productId: pid('3'), reason: 'DELIVERY_FAILED' }] });
    n = 1;
    await expect(all.execute({ tenantId: TENANT, huntId: HUNT, runId: s.run.id })).rejects.toThrow('db down');
  });

  it('execução expirada → 409 OFFER_HUNT_RANKING_EXPIRED', async () => {
    const s = await withDestination(setup({ runAgeMs: 49 * HOUR }));
    await expect(s.all.execute({ tenantId: TENANT, huntId: HUNT, runId: s.run.id })).rejects.toMatchObject({ code: 'OFFER_HUNT_RANKING_EXPIRED' });
  });
});

describe('GetOfferHuntRunUseCase — repetidos de outra execução', () => {
  it('marca os do ranking já entregues por outra execução na janela; fora da janela ou desta execução, não', async () => {
    const s = setup({ ranking: [item('1', { chosen: true }), item('2'), item('3'), item('4')] });
    s.finds.seed({ runId: s.run.id, productId: pid('1'), createdAt: s.now });
    s.finds.seed({ runId: 'other', productId: pid('2'), createdAt: s.now });
    s.finds.seed({ runId: 'old', productId: pid('3'), createdAt: new Date(s.now.getTime() - 8 * 24 * HOUR) });
    const get = new GetOfferHuntRunUseCase({ runs: s.runs, hunts: s.hunts, finds: s.finds, now: () => s.now });
    const out = await get.execute({ tenantId: TENANT, huntId: HUNT, runId: s.run.id });
    expect(out).toMatchObject({ sentProductIds: [pid('1')], repeatedProductIds: [pid('2')], rankingReusable: true });
  });

  it('ranking fora das 48 h → repetidos vazio (sem consulta)', async () => {
    const s = setup({ runAgeMs: 49 * HOUR });
    s.finds.seed({ runId: 'other', productId: pid('2'), createdAt: s.now });
    const get = new GetOfferHuntRunUseCase({ runs: s.runs, hunts: s.hunts, finds: s.finds, now: () => s.now });
    expect(await get.execute({ tenantId: TENANT, huntId: HUNT, runId: s.run.id })).toMatchObject({ repeatedProductIds: [], rankingReusable: false });
  });
});
