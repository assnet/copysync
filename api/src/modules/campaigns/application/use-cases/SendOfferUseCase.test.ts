import { describe, it, expect } from 'vitest';
import { SendOfferUseCase } from './SendOfferUseCase';
import {
  FakeEntitlementReader,
  InMemoryOfferDispatchRepository,
  InMemoryOfferGeneratorConfigRepository,
  InMemoryOfferRepository,
  makeOffer,
  NOW,
  TENANT,
} from './offerTestFakes';
import type { Offer } from '../../domain/entities/Offer';

const GROUPS = ['c1', 'c2', 'c3'];

function setup(
  opts: {
    offer?: Partial<Offer>;
    selected?: string[];
    sessionStatus?: string;
    configured?: boolean;
    entitlements?: Record<string, unknown>;
  } = {},
) {
  const offers = new InMemoryOfferRepository();
  offers.items.push(makeOffer(opts.offer));
  const dispatches = new InMemoryOfferDispatchRepository(offers);
  const configs = new InMemoryOfferGeneratorConfigRepository(
    [{ id: 's1', tenantId: TENANT, status: opts.sessionStatus ?? 'CONNECTED' }],
    [
      ...GROUPS.map((id) => ({ id, tenantId: TENANT, sessionId: 's1', isGroup: true })),
      { id: 'old', tenantId: TENANT, sessionId: 's-old', isGroup: true },
    ],
  );
  if (opts.configured !== false) {
    configs.configs.set(TENANT, {
      tenantId: TENANT, sessionId: 's1', intervalMinSeconds: 8, intervalMaxSeconds: 16, updatedAt: NOW,
    });
  }
  configs.selected.set(TENANT, opts.selected ?? GROUPS);
  const uc = new SendOfferUseCase({
    offers, dispatches, configs, entitlements: new FakeEntitlementReader(opts.entitlements), now: () => NOW, rand: () => 0.5,
  });
  return { offers, dispatches, configs, uc };
}

const input = { tenantId: TENANT, offerId: 'offer-1' };

describe('SendOfferUseCase', () => {
  it('DRAFT → SENDING, um envio por grupo da configuração, intervalo da configuração', async () => {
    const s = setup();
    const out = await s.uc.execute(input);
    expect(out.offer.status).toBe('SENDING');
    expect(s.offers.items[0]!.status).toBe('SENDING');
    expect(out.dispatches.map((d) => [d.conversationId, d.status, d.notBefore])).toEqual([
      ['c1', 'QUEUED', NOW.toISOString()],
      ['c2', 'QUEUED', new Date(NOW.getTime() + 12000).toISOString()],
      ['c3', 'QUEUED', new Date(NOW.getTime() + 24000).toISOString()],
    ]);
  });

  it('grupo de outra sessão (resto antigo) não recebe', async () => {
    const s = setup({ selected: ['c1', 'old'] });
    const out = await s.uc.execute(input);
    expect(out.dispatches.map((d) => d.conversationId)).toEqual(['c1']);
  });

  it('sem configuração → OFFER_CONFIG_MISSING 409, nada enfileirado', async () => {
    const s = setup({ configured: false });
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'OFFER_CONFIG_MISSING', statusCode: 409 });
    expect(s.dispatches.items).toHaveLength(0);
  });

  it('sessão apagada → OFFER_CONFIG_MISSING', async () => {
    const s = setup();
    s.configs.sessions = [];
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'OFFER_CONFIG_MISSING' });
  });

  it('sessão desconectada → SESSION_NOT_CONNECTED antes de enfileirar', async () => {
    const s = setup({ sessionStatus: 'DISCONNECTED' });
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'SESSION_NOT_CONNECTED', statusCode: 409 });
    expect(s.offers.items[0]!.status).toBe('DRAFT');
    expect(s.dispatches.items).toHaveLength(0);
  });

  it('sem grupos → OFFER_NO_DESTINATIONS e oferta segue DRAFT', async () => {
    const s = setup({ selected: [] });
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'OFFER_NO_DESTINATIONS', statusCode: 422 });
    expect(s.offers.items[0]!.status).toBe('DRAFT');
  });

  it('grupos acima do plano (rebaixado) → PLAN_LIMIT_REACHED', async () => {
    const s = setup({ entitlements: { broadcast_groups: 2 } });
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: 'broadcast_groups', limit: 2 } });
  });

  it('mentionAll com mention_all_enabled=false → PLAN_FEATURE_UNAVAILABLE 403', async () => {
    const s = setup({ offer: { mentionAll: true }, entitlements: { mention_all_enabled: false } });
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', statusCode: 403 });
    expect(s.dispatches.items).toHaveLength(0);
  });

  it('mentionAll sem entitlement (ausente) → permitido', async () => {
    const s = setup({ offer: { mentionAll: true } });
    await expect(s.uc.execute(input)).resolves.toBeDefined();
  });

  it.each(['SENDING', 'SENT', 'FAILED'] as const)('oferta %s → OFFER_ALREADY_SENT', async (status) => {
    const s = setup({ offer: { status } });
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'OFFER_ALREADY_SENT', statusCode: 409 });
    expect(s.dispatches.items).toHaveLength(0);
  });

  it('segundo envio da mesma oferta → OFFER_ALREADY_SENT', async () => {
    const s = setup();
    await s.uc.execute(input);
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'OFFER_ALREADY_SENT' });
    expect(s.dispatches.items).toHaveLength(3);
  });

  it('corrida na transição (startSending null) → OFFER_ALREADY_SENT', async () => {
    const s = setup();
    s.dispatches.startSending = async () => {
      (await s.offers.findById('offer-1', TENANT))!.status = 'SENDING';
      return null;
    };
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'OFFER_ALREADY_SENT' });
  });

  it('mentionAll ligado depois da validação → OFFER_CHANGED sem enfileirar', async () => {
    const s = setup({ offer: { mentionAll: false }, entitlements: { mention_all_enabled: false } });
    const original = s.dispatches.startSending.bind(s.dispatches);
    s.dispatches.startSending = async (...args) => {
      (await s.offers.findById(args[0], args[1]))!.mentionAll = true;
      return original(...args);
    };
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'OFFER_CHANGED', statusCode: 409 });
    expect(s.dispatches.items).toHaveLength(0);
    expect((await s.offers.findById('offer-1', TENANT))!.status).toBe('DRAFT');
  });

  it('startSending recebe o mentionAll validado', async () => {
    const s = setup({ offer: { mentionAll: true } });
    const calls: unknown[] = [];
    const original = s.dispatches.startSending.bind(s.dispatches);
    s.dispatches.startSending = async (...args) => { calls.push(args[2]); return original(...args); };
    await s.uc.execute(input);
    expect(calls).toEqual([{ mentionAll: true }]);
  });

  it('oferta inexistente → OFFER_NOT_FOUND', async () => {
    const s = setup();
    await expect(s.uc.execute({ ...input, offerId: 'x' })).rejects.toMatchObject({ code: 'OFFER_NOT_FOUND' });
  });
});
