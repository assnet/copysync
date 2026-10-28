import { describe, expect, it } from 'vitest';
import { EnqueueOfferUseCase, type EnqueueOfferInput } from './EnqueueOfferUseCase';
import { InMemoryOfferDispatchRepository, InMemoryOfferRepository, makeOffer, NOW, TENANT } from './offerTestFakes';

const input = (o: Partial<EnqueueOfferInput> = {}): EnqueueOfferInput => ({
  tenantId: TENANT, destinations: [{ conversationId: 'g1', sessionId: 's1' }, { conversationId: 'g2', sessionId: 's1' }], origin: 'MONITORING', provider: 'AMAZON',
  sourceUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH', affiliateUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=t-20',
  title: 'Fone', text: 'Fone https://www.amazon.com.br/dp/B0ABCDEFGH?tag=t-20', imageUrl: 'store://1.jpg', coupon: 'PROMO10',
  mentionAll: true, simulateTyping: true, typingSeconds: 10, startAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000),
  intervalMinSeconds: 60, intervalMaxSeconds: 120, ...o,
});

function setup() {
  const offers = new InMemoryOfferRepository();
  const dispatches = new InMemoryOfferDispatchRepository(offers);
  return { offers, dispatches, uc: new EnqueueOfferUseCase({ offers, dispatches, rand: () => 0.5 }) };
}

describe('EnqueueOfferUseCase', () => {
  it('cria oferta SENDING de origem MONITORING com validade e um envio por destino na faixa da sessão', async () => {
    const s = setup();
    const out = await s.uc.execute(input());
    expect(out).toMatchObject({ kind: 'queued', firstSendAt: NOW });
    const offer = s.offers.items[0]!;
    expect(offer).toMatchObject({ status: 'SENDING', origin: 'MONITORING', coupon: 'PROMO10', mentionAll: true, simulateTyping: true, typingSeconds: 10 });
    expect(offer.expiresAt).toEqual(new Date(NOW.getTime() + 3_600_000));
    expect(s.dispatches.items.map((d) => [d.conversationId, d.sessionId, d.gapSeconds, d.notBefore.getTime() - NOW.getTime()])).toEqual([
      ['g1', 's1', 60, 0], ['g2', 's1', 60, 90_000],
    ]);
  });

  it('entra depois do que já está na fila da sessão', async () => {
    const s = setup();
    s.offers.items.push(makeOffer({ id: 'gen', status: 'SENDING' }));
    s.dispatches.add({ offerId: 'gen', conversationId: 'x', sessionId: 's1', notBefore: new Date(NOW.getTime() + 600_000) });
    const out = await s.uc.execute(input());
    expect(out.kind === 'queued' && out.firstSendAt.getTime() - NOW.getTime()).toBe(690_000);
  });

  it('mesma chave idempotente: devolve a oferta existente e não cria outra', async () => {
    const s = setup();
    const a = await s.uc.execute(input({ sourceKey: 'captured:1' }));
    const b = await s.uc.execute(input({ sourceKey: 'captured:1' }));
    expect(b).toEqual(a);
    expect(s.offers.items).toHaveLength(1);
    expect(s.dispatches.items).toHaveLength(2);
  });

  it('oferta da mesma chave ficou DRAFT (queda antes de enfileirar): enfileira a existente', async () => {
    const s = setup();
    s.offers.items.push(makeOffer({ id: 'orfa', status: 'DRAFT', sourceKey: 'captured:9', mentionAll: true }));
    const out = await s.uc.execute(input({ sourceKey: 'captured:9' }));
    expect(out).toMatchObject({ kind: 'queued', offerId: 'orfa' });
    expect(s.offers.items).toHaveLength(1);
    expect(s.offers.items[0]!.status).toBe('SENDING');
    expect(s.dispatches.items).toHaveLength(2);
  });

  it('DRAFT órfã com marcar todos diferente do atual: enfileira com o valor salvo (não falha)', async () => {
    const s = setup();
    s.offers.items.push(makeOffer({ id: 'orfa', status: 'DRAFT', sourceKey: 'captured:8', mentionAll: true }));
    const out = await s.uc.execute(input({ sourceKey: 'captured:8', mentionAll: false }));
    expect(out).toMatchObject({ kind: 'queued', offerId: 'orfa' });
    expect(s.offers.items[0]!.status).toBe('SENDING');
  });

  it('fila empurraria para depois da validade: não cria nada', async () => {
    const s = setup();
    s.offers.items.push(makeOffer({ id: 'gen', status: 'SENDING' }));
    s.dispatches.add({ offerId: 'gen', conversationId: 'x', sessionId: 's1', notBefore: new Date(NOW.getTime() + 7_200_000) });
    const out = await s.uc.execute(input());
    expect(out.kind).toBe('expired');
    expect(s.offers.items).toHaveLength(1);
  });
});

describe('EnqueueOfferUseCase — sessão cruzada', () => {
  it('destinos de duas sessões: cada envio na faixa da própria sessão, ordem e intervalo mantidos', async () => {
    const s = setup();
    await s.uc.execute(input({ destinations: [{ conversationId: 'g1', sessionId: 's1' }, { conversationId: 'g9', sessionId: 's2' }, { conversationId: 'g2', sessionId: 's1' }] }));
    expect(s.dispatches.items.map((d) => [d.conversationId, d.sessionId, d.notBefore.getTime() - NOW.getTime()])).toEqual([
      ['g1', 's1', 0], ['g9', 's2', 90_000], ['g2', 's1', 180_000],
    ]);
  });
});
