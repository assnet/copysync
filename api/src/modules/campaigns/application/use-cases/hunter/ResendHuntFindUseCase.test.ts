import { describe, expect, it, vi } from 'vitest';
import { ResendHuntFindUseCase, HUNT_FIND_RESEND_COOLDOWN_MS } from './ResendHuntFindUseCase';
import { HuntFindDelivery } from '../../services/hunter/HuntFindDelivery';
import { EnqueueOfferUseCase } from '../EnqueueOfferUseCase';
import {
  FakeEntitlementReader, InMemoryOfferDispatchRepository, InMemoryOfferGeneratorConfigRepository, InMemoryOfferRepository,
} from '../offerTestFakes';
import { InMemoryFinds, InMemoryRuns, InMemorySettings, MAX_ENTITLEMENTS, NOW, TENANT } from './hunterTestFakes';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';

function setup(ent: Record<string, unknown> = {}) {
  const finds = new InMemoryFinds();
  const runs = new InMemoryRuns();
  const settings = new InMemorySettings();
  const offers = new InMemoryOfferRepository();
  const dispatches = new InMemoryOfferDispatchRepository(offers);
  const entitlements = new FakeEntitlementReader({ ...MAX_ENTITLEMENTS, ...ent });
  const resolve = vi.fn(async (_t: string, url: string) => ({
    provider: 'SHEIN' as const, sourceUrl: url, affiliateUrl: 'https://onelink.shein.com/1/tenant-new', attributionVerified: true, linkRebuilt: true,
    product: { productRef: '1', title: 'Vestido hoje', priceCents: 4990, originalPriceCents: null, imageSourceUrl: null },
  }));
  let clock = NOW;
  const delivery = new HuntFindDelivery({
    finds, runs, settings,
    affiliateProducts: { execute: resolve },
    texts: { compose: async (i) => ({ text: `${i.title} ${i.affiliateUrl}`, aiFallback: false }) },
    images: { storeImage: async () => null, discardImage: async () => {} },
    enqueue: new EnqueueOfferUseCase({ offers, dispatches, rand: () => 0 }),
    configs: new InMemoryOfferGeneratorConfigRepository(),
    now: () => clock,
  });
  const uc = new ResendHuntFindUseCase({ finds, entitlements, delivery, now: () => clock });
  const tick = (ms: number) => { clock = new Date(clock.getTime() + ms); };
  const sent = () => finds.seed({ status: 'SENT', offerId: 'offer-old', delivery: { dispatchStatus: 'SENT', sentAt: NOW, groupName: 'G', sessionName: 'S' } });
  return { finds, settings, offers, resolve, uc, tick, sent };
}

describe('ResendHuntFindUseCase', () => {
  it('cria oferta nova (HUNTER, sourceKey distinto, destino atual), troca offerId e não mexe no teto', async () => {
    const s = setup();
    await s.settings.upsert(TENANT, 'session-2', 'conv-2');
    const find = s.sent();
    const used = await s.finds.countCreatedSince(TENANT, new Date(0));
    const out = await s.uc.execute({ tenantId: TENANT, findId: find.id });
    const offer = s.offers.items[0]!;
    expect(offer).toMatchObject({ origin: 'HUNTER', sourceKey: `hunt:${find.id}:r${NOW.getTime()}`, affiliateUrl: 'https://onelink.shein.com/1/tenant-new' });
    expect(s.resolve).toHaveBeenCalledWith(TENANT, expect.stringContaining(find.goodsId), { riskScope: 'OFFER_HUNTER' });
    expect(out).toMatchObject({ status: 'SENT', offerId: offer.id, resendCount: 1, lastResentAt: NOW });
    expect(await s.finds.countCreatedSince(TENANT, new Date(0))).toBe(used);
    expect(s.finds.items).toHaveLength(1);

    // Outro dia: chave diferente, outra oferta
    s.tick(HUNT_FIND_RESEND_COOLDOWN_MS + 1);
    s.finds.items[0]!.delivery = { dispatchStatus: 'SENT', sentAt: NOW, groupName: 'G', sessionName: 'S' };
    await s.uc.execute({ tenantId: TENANT, findId: find.id });
    expect(new Set(s.offers.items.map((o) => o.sourceKey)).size).toBe(2);
    expect(s.finds.items[0]!.resendCount).toBe(2);
  });

  it('disparo anterior na fila/enviando → 409 OFFER_HUNT_RESEND_PENDING, sem chamar a loja', async () => {
    const s = setup();
    await s.settings.upsert(TENANT, 'session-1', 'conv-1');
    for (const dispatchStatus of ['QUEUED', 'SENDING'] as const) {
      const f = s.finds.seed({ status: 'SENT', offerId: 'o1', delivery: { dispatchStatus, sentAt: null, groupName: null, sessionName: null } });
      await expect(s.uc.execute({ tenantId: TENANT, findId: f.id })).rejects.toMatchObject({ code: 'OFFER_HUNT_RESEND_PENDING', statusCode: 409 });
    }
    expect(s.resolve).not.toHaveBeenCalled();
  });

  it('clique duplo dentro de 60 s → 2º recusado (uma oferta só)', async () => {
    const s = setup();
    await s.settings.upsert(TENANT, 'session-1', 'conv-1');
    const find = s.sent();
    const [a, b] = await Promise.allSettled([s.uc.execute({ tenantId: TENANT, findId: find.id }), s.uc.execute({ tenantId: TENANT, findId: find.id })]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(s.offers.items).toHaveLength(1);
  });

  it('sem oferta (pendente/dispensado) → 409 OFFER_HUNT_RESEND_NOT_DELIVERED', async () => {
    const s = setup();
    for (const status of ['PENDING_REVIEW', 'DISMISSED'] as const) {
      const f = s.finds.seed({ status });
      await expect(s.uc.execute({ tenantId: TENANT, findId: f.id })).rejects.toMatchObject({ code: 'OFFER_HUNT_RESEND_NOT_DELIVERED', statusCode: 409 });
    }
  });

  it('outro tenant → 404; sem caçador no plano → recusa', async () => {
    const s = setup();
    const f = s.sent();
    await expect(s.uc.execute({ tenantId: 'tenant-x', findId: f.id })).rejects.toMatchObject({ code: 'OFFER_HUNT_NOT_FOUND', statusCode: 404 });
    const off = setup({ [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]: false });
    await expect(off.uc.execute({ tenantId: TENANT, findId: off.sent().id })).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
  });
});
