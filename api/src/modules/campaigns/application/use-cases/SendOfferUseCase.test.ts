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
    sessionIds?: string[];
    dispatchOrder?: 'SEQUENTIAL' | 'INTERLEAVED';
    configured?: boolean;
    entitlements?: Record<string, unknown>;
  } = {},
) {
  const offers = new InMemoryOfferRepository();
  offers.items.push(makeOffer(opts.offer));
  const dispatches = new InMemoryOfferDispatchRepository(offers);
  const configs = new InMemoryOfferGeneratorConfigRepository(
    [{ id: 's1', tenantId: TENANT, status: opts.sessionStatus ?? 'CONNECTED' }, { id: 's2', tenantId: TENANT, status: 'CONNECTED' }],
    [
      ...GROUPS.map((id) => ({ id, tenantId: TENANT, sessionId: 's1', isGroup: true })),
      { id: 'old', tenantId: TENANT, sessionId: 's-old', isGroup: true },
      { id: 'd1', tenantId: TENANT, sessionId: 's2', isGroup: true },
      { id: 'd2', tenantId: TENANT, sessionId: 's2', isGroup: true },
    ],
  );
  if (opts.configured !== false) {
    configs.configs.set(TENANT, {
      tenantId: TENANT, sessionIds: opts.sessionIds ?? ['s1'], intervalMinSeconds: 8, intervalMaxSeconds: 16,
      dispatchOrder: opts.dispatchOrder ?? 'SEQUENTIAL', updatedAt: NOW,
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

  it('duas sessões INTERLEAVED: alterna S1/S2 com o mesmo intervalo entre todos os envios', async () => {
    const s = setup({ sessionIds: ['s1', 's2'], dispatchOrder: 'INTERLEAVED', selected: ['c1', 'c2', 'd1', 'd2', 'c3'], entitlements: { cross_session_dispatch: true } });
    const out = await s.uc.execute(input);
    expect(out.dispatches.map((d) => d.conversationId)).toEqual(['c1', 'd1', 'c2', 'd2', 'c3']);
    expect(out.dispatches.map((d) => Date.parse(d.notBefore) - NOW.getTime())).toEqual([0, 12000, 24000, 36000, 48000]);
  });

  it('duas sessões SEQUENTIAL na ordem configurada; sessão desconectada bloqueia tudo', async () => {
    const s = setup({ sessionIds: ['s2', 's1'], selected: ['c1', 'd1', 'c2'], entitlements: { cross_session_dispatch: true } });
    const out = await s.uc.execute(input);
    expect(out.dispatches.map((d) => d.conversationId)).toEqual(['d1', 'c1', 'c2']);

    const off = setup({ sessionIds: ['s1', 's2'], sessionStatus: 'DISCONNECTED', selected: ['c1', 'd1'], entitlements: { cross_session_dispatch: true } });
    await expect(off.uc.execute(input)).rejects.toMatchObject({ code: 'SESSION_NOT_CONNECTED' });
    expect(off.dispatches.items).toHaveLength(0);
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

describe('SendOfferUseCase — início agendado', () => {
  it('primeiro envio no horário agendado; os seguintes encadeados a partir dele', async () => {
    const at = new Date(NOW.getTime() + 2 * 60 * 60_000);
    const s = setup({ offer: { scheduledAt: at } });
    const out = await s.uc.execute(input);
    expect(out.offer.status).toBe('SENDING');
    expect(out.dispatches[0]!.notBefore).toBe(at.toISOString());
    expect(Date.parse(out.dispatches[1]!.notBefore)).toBe(at.getTime() + 12_000);
  });

  it('agendamento já vencido no disparo: começa agora', async () => {
    const s = setup({ offer: { scheduledAt: new Date(NOW.getTime() - 60_000) } });
    const out = await s.uc.execute(input);
    expect(out.dispatches[0]!.notBefore).toBe(NOW.toISOString());
  });
});

describe('SendOfferUseCase — fila por sessão', () => {
  it('cada envio leva a sessão e o intervalo mínimo da configuração (faixa do worker)', async () => {
    const s = setup();
    await s.uc.execute(input);
    expect(s.dispatches.items.map((d) => [d.sessionId, d.gapSeconds])).toEqual([['s1', 8], ['s1', 8], ['s1', 8]]);
  });

  it('com outra oferta em curso na mesma sessão, entra depois do fim dela + folga, sem mudar o espaçamento', async () => {
    const s = setup();
    s.offers.items.push(makeOffer({ id: 'running', status: 'SENDING' }));
    const tail = new Date(NOW.getTime() + 600_000);
    s.dispatches.add({ offerId: 'running', conversationId: 'x', sessionId: 's1', notBefore: tail });
    await s.uc.execute(input);
    const mine = s.dispatches.items.filter((d) => d.offerId === 'offer-1').map((d) => d.notBefore.getTime() - tail.getTime());
    // folga e intervalo = meio de 8–16 s
    expect(mine).toEqual([12_000, 24_000, 36_000]);
  });

  it('oferta agendada para depois não segura quem dispara agora', async () => {
    const s = setup();
    s.offers.items.push(makeOffer({ id: 'later', status: 'SENDING', scheduledAt: new Date(NOW.getTime() + 3_600_000) }));
    s.dispatches.add({ offerId: 'later', conversationId: 'x', sessionId: 's1', notBefore: new Date(NOW.getTime() + 3_600_000) });
    await s.uc.execute(input);
    expect(s.dispatches.items.find((d) => d.offerId === 'offer-1')!.notBefore).toEqual(NOW);
  });
});

describe('SendOfferUseCase — sessão cruzada', () => {
  it('plano rebaixado depois de salvar 2 sessões: só a principal dispara', async () => {
    const s = setup({ sessionIds: ['s1', 's2'], selected: ['c1', 'd1'] });
    await s.uc.execute(input);
    expect(s.dispatches.items.map((d) => d.conversationId)).toEqual(['c1']);
  });

  it('com cross_session_dispatch as duas sessões disparam', async () => {
    const s = setup({ sessionIds: ['s1', 's2'], selected: ['c1', 'd1'], entitlements: { cross_session_dispatch: true } });
    await s.uc.execute(input);
    expect(s.dispatches.items.map((d) => [d.conversationId, d.sessionId])).toEqual([['c1', 's1'], ['d1', 's2']]);
  });
});
