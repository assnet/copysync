import { describe, expect, it, vi } from 'vitest';
import { ApproveHuntFindUseCase, DismissHuntFindUseCase } from './HuntFindDecisionUseCases';
import { SetOfferHunterDestinationUseCase } from './SetOfferHunterDestinationUseCase';
import { HuntFindDelivery } from '../../services/hunter/HuntFindDelivery';
import { EnqueueOfferUseCase } from '../EnqueueOfferUseCase';
import {
  FakeEntitlementReader, InMemoryOfferDispatchRepository, InMemoryOfferGeneratorConfigRepository, InMemoryOfferRepository,
} from '../offerTestFakes';
import { InMemoryFinds, InMemoryRuns, InMemorySettings, MAX_ENTITLEMENTS, NOW, TENANT } from './hunterTestFakes';
import type { BroadcastGroupUsageRow, ListBroadcastGroupRowsOptions } from '../../../domain/contracts/IBroadcastGroupUsageReader';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';
import { AffiliateCredentialRejectedError } from '../../../../../shared/errors/internal/OfferErrors';

function setup() {
  const finds = new InMemoryFinds();
  const runs = new InMemoryRuns();
  const settings = new InMemorySettings();
  const offers = new InMemoryOfferRepository();
  const dispatches = new InMemoryOfferDispatchRepository(offers);
  const entitlements = new FakeEntitlementReader({ ...MAX_ENTITLEMENTS });
  const resolve = vi.fn(async (_t: string, url: string, _o?: unknown) => ({
    provider: 'SHEIN' as const, sourceUrl: url, affiliateUrl: 'https://onelink.shein.com/1/tenant', attributionVerified: true, linkRebuilt: true,
    product: { productRef: '1', title: null, priceCents: null, originalPriceCents: null, imageSourceUrl: 'https://img.ltwebstatic.com/a.jpg' },
  }));
  const composeInputs: unknown[] = [];
  const delivery = new HuntFindDelivery({
    finds, runs, settings,
    affiliateProducts: { execute: resolve },
    texts: { compose: async (i) => { composeInputs.push(i); return { text: `${i.title} ${i.affiliateUrl}`, aiFallback: false }; } },
    images: { storeImage: async () => '/media/offer.jpg', discardImage: vi.fn(async () => {}) },
    enqueue: new EnqueueOfferUseCase({ offers, dispatches, rand: () => 0 }),
    configs: new InMemoryOfferGeneratorConfigRepository(),
    now: () => NOW,
  });
  const approve = new ApproveHuntFindUseCase({ finds, entitlements, delivery });
  const dismiss = new DismissHuntFindUseCase({ finds });
  return { finds, runs, settings, offers, entitlements, resolve, composeInputs, approve, dismiss };
}

describe('ApproveHuntFindUseCase', () => {
  it('entrega pelo Enqueue (HUNTER, hunt:<id>, grupo do destino) com o link do tenant e grava SENT + offerId', async () => {
    const s = setup();
    await s.settings.upsert(TENANT, 'session-1', 'conv-1');
    const run = await s.runs.startWithinDailyLimit({ tenantId: TENANT, huntId: 'hunt-1', trigger: 'MANUAL', startedAt: NOW }, { since: NOW, limit: 24 });
    const find = s.finds.seed({ goodsId: '533885353', runId: run!.id });
    const out = await s.approve.execute({ tenantId: TENANT, findId: find.id });
    expect(s.resolve).toHaveBeenCalledWith(TENANT, 'https://br.shein.com/product-p-533885353.html', { riskScope: 'OFFER_HUNTER' });
    const offer = s.offers.items[0]!;
    expect(offer).toMatchObject({
      origin: 'HUNTER', sourceKey: `hunt:${find.id}`, affiliateUrl: 'https://onelink.shein.com/1/tenant', imageUrl: '/media/offer.jpg',
      title: 'Vestido Midi Floral', coupon: null,
    });
    expect(s.composeInputs[0]).toMatchObject({ audience: 'STANDARD', title: 'Vestido Midi Floral', priceCents: 5990 });
    expect(out).toMatchObject({ offerId: offer.id, find: { status: 'SENT', offerId: offer.id } });
    expect(s.runs.items[0]!.sentCount).toBe(1);
  });

  it('sem destino → OFFER_HUNT_DESTINATION_REQUIRED e o achado não muda', async () => {
    const s = setup();
    const find = s.finds.seed({});
    await expect(s.approve.execute({ tenantId: TENANT, findId: find.id })).rejects.toMatchObject({ code: 'OFFER_HUNT_DESTINATION_REQUIRED' });
    expect(s.finds.items[0]!.status).toBe('PENDING_REVIEW');
    expect(s.resolve).not.toHaveBeenCalled();
  });

  it('achado já enviado ou de outro tenant: 409 / 404, sem nova oferta', async () => {
    const s = setup();
    await s.settings.upsert(TENANT, 'session-1', 'conv-1');
    const sent = s.finds.seed({ status: 'SENT' });
    await expect(s.approve.execute({ tenantId: TENANT, findId: sent.id })).rejects.toMatchObject({ code: 'OFFER_HUNT_FIND_INVALID_STATE', statusCode: 409 });
    await expect(s.approve.execute({ tenantId: 'other', findId: sent.id })).rejects.toMatchObject({ code: 'OFFER_HUNT_NOT_FOUND' });
    expect(s.offers.items).toHaveLength(0);
  });

  it('falha no link: achado FAILED com o código e o erro sobe; aprovar de novo reenvia sem duplicar', async () => {
    const s = setup();
    await s.settings.upsert(TENANT, 'session-1', 'conv-1');
    const find = s.finds.seed({});
    s.resolve.mockRejectedValueOnce(new AffiliateCredentialRejectedError('SHEIN'));
    await expect(s.approve.execute({ tenantId: TENANT, findId: find.id })).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
    expect(s.finds.items[0]).toMatchObject({ status: 'FAILED', failureReason: 'AFFILIATE_CREDENTIAL_REJECTED' });
    await s.approve.execute({ tenantId: TENANT, findId: find.id });
    await expect(s.approve.execute({ tenantId: TENANT, findId: find.id })).rejects.toMatchObject({ code: 'OFFER_HUNT_FIND_INVALID_STATE' });
    expect(s.offers.items).toHaveLength(1);
    expect(s.finds.items[0]).toMatchObject({ status: 'SENT', failureReason: null });
  });

  it('caçador fora do plano → PLAN_FEATURE_UNAVAILABLE', async () => {
    const s = setup();
    s.entitlements.values[ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED] = false;
    const find = s.finds.seed({});
    await expect(s.approve.execute({ tenantId: TENANT, findId: find.id })).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
  });
});

describe('DismissHuntFindUseCase', () => {
  it('PENDING_REVIEW → DISMISSED; segue contando no teto; segunda vez 409', async () => {
    const s = setup();
    const find = s.finds.seed({});
    expect((await s.dismiss.execute({ tenantId: TENANT, findId: find.id })).status).toBe('DISMISSED');
    expect(await s.finds.countCreatedSince(TENANT, NOW)).toBe(1);
    await expect(s.dismiss.execute({ tenantId: TENANT, findId: find.id })).rejects.toMatchObject({ code: 'OFFER_HUNT_FIND_INVALID_STATE' });
    await expect(s.dismiss.execute({ tenantId: 'other', findId: find.id })).rejects.toMatchObject({ code: 'OFFER_HUNT_NOT_FOUND' });
  });
});

describe('SetOfferHunterDestinationUseCase', () => {
  function destSetup(limit: number | null, others: BroadcastGroupUsageRow[] = []) {
    const settings = new InMemorySettings();
    const configs = new InMemoryOfferGeneratorConfigRepository(
      [{ id: 's1', status: 'CONNECTED', tenantId: TENANT }, { id: 's2', status: 'CONNECTED', tenantId: 'other' }],
      [
        { id: 'g1', tenantId: TENANT, sessionId: 's1', isGroup: true, groupJid: '1@g.us' },
        { id: 'g2', tenantId: TENANT, sessionId: 's1', isGroup: true, groupJid: '2@g.us' },
        { id: 'c1', tenantId: TENANT, sessionId: 's1', isGroup: false },
      ],
    );
    const calls: ListBroadcastGroupRowsOptions[] = [];
    const groupUsage = { listRows: async (_t: string, o: ListBroadcastGroupRowsOptions = {}) => { calls.push(o); return others; } };
    const entitlements = new FakeEntitlementReader({ ...MAX_ENTITLEMENTS, [ENTITLEMENT_KEYS.BROADCAST_GROUPS]: limit });
    return { settings, calls, uc: new SetOfferHunterDestinationUseCase({ settings, configs, groupUsage, entitlements }) };
  }
  const used = (groupJid: string): BroadcastGroupUsageRow => ({ conversationId: `c-${groupJid}`, sessionId: 's1', groupJid, engine: 'baileys', use: 'generator' });

  it('grava sessão + grupo do tenant; união ignora o próprio destino do caçador', async () => {
    const s = destSetup(1);
    expect(await s.uc.execute({ tenantId: TENANT, sessionId: 's1', conversationId: 'g1' })).toMatchObject({ sessionId: 's1', conversationId: 'g1' });
    expect(s.calls).toEqual([{ exceptHunter: true }]);
  });

  it('grupo já usado pelo gerador não conta de novo (D3)', async () => {
    const s = destSetup(1, [used('1@g.us')]);
    await expect(s.uc.execute({ tenantId: TENANT, sessionId: 's1', conversationId: 'g1' })).resolves.toBeTruthy();
  });

  it('grupo novo acima do limite da união → PLAN_LIMIT_REACHED e nada grava', async () => {
    const s = destSetup(1, [used('1@g.us')]);
    await expect(s.uc.execute({ tenantId: TENANT, sessionId: 's1', conversationId: 'g2' })).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    expect(s.settings.items.size).toBe(0);
  });

  it('sessão de outro tenant, conversa que não é grupo ou plano sem caçador → recusa', async () => {
    const s = destSetup(null);
    await expect(s.uc.execute({ tenantId: TENANT, sessionId: 's2', conversationId: 'g1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(s.uc.execute({ tenantId: TENANT, sessionId: 's1', conversationId: 'c1' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(s.uc.execute({ tenantId: TENANT, sessionId: ' ', conversationId: 'g1' })).rejects.toMatchObject({ code: 'OFFER_INVALID_INPUT' });
    const t = destSetup(null);
    (t.uc as unknown as { deps: { entitlements: FakeEntitlementReader } }).deps.entitlements.values[ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED] = false;
    await expect(t.uc.execute({ tenantId: TENANT, sessionId: 's1', conversationId: 'g1' })).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
    expect(s.settings.items.size + t.settings.items.size).toBe(0);
  });
});
