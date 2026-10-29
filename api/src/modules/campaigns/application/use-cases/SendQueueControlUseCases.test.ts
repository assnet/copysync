import { describe, expect, it } from 'vitest';
import { PauseAllSendsUseCase, ResumeAllSendsUseCase } from './SendQueueControlUseCases';
import { InMemoryOfferDispatchRepository, InMemoryOfferGeneratorConfigRepository, InMemoryOfferRepository, makeOffer, NOW, TENANT } from './offerTestFakes';

function setup() {
  const offers = new InMemoryOfferRepository();
  const dispatches = new InMemoryOfferDispatchRepository(offers);
  const configs = new InMemoryOfferGeneratorConfigRepository([], []);
  configs.configs.set(TENANT, { tenantId: TENANT, sessionIds: ['s1'], intervalMinSeconds: 100, intervalMaxSeconds: 200, dispatchOrder: 'SEQUENTIAL', updatedAt: NOW });
  const pauses = { pausedAt: null as Date | null, async get() { return this.pausedAt; }, async set(_t: string, at: Date | null) { this.pausedAt = at; } };
  const deps = { pauses, dispatches, configs, now: () => NOW, rand: () => 0.5 };
  return { offers, dispatches, pauses, pause: new PauseAllSendsUseCase(deps), resume: new ResumeAllSendsUseCase(deps) };
}

describe('PauseAllSendsUseCase', () => {
  it('grava o instante e é idempotente (pausar de novo mantém o original)', async () => {
    const s = setup();
    expect(await s.pause.execute({ tenantId: TENANT })).toEqual({ sendingPausedAt: NOW.toISOString() });
    s.pauses.pausedAt = new Date(NOW.getTime() - 60_000);
    expect(await s.pause.execute({ tenantId: TENANT })).toEqual({ sendingPausedAt: new Date(NOW.getTime() - 60_000).toISOString() });
  });
});

describe('ResumeAllSendsUseCase', () => {
  it('sem pausa ativa é no-op: não mexe na fila', async () => {
    const s = setup();
    s.offers.items.push(makeOffer({ id: 'a', status: 'SENDING' }));
    s.dispatches.add({ offerId: 'a', conversationId: 'c1', sessionId: 's1', notBefore: new Date(NOW.getTime() - 60_000) });
    expect(await s.resume.execute({ tenantId: TENANT })).toEqual({ sendingPausedAt: null });
    expect(s.dispatches.items[0]!.notBefore).toEqual(new Date(NOW.getTime() - 60_000));
  });

  it('oferta vencida pela validade não ocupa lugar no reespalhar', async () => {
    const s = setup();
    s.pauses.pausedAt = new Date(NOW.getTime() - 3_600_000);
    s.offers.items.push(makeOffer({ id: 'old', status: 'SENDING', expiresAt: new Date(NOW.getTime() - 1000) }), makeOffer({ id: 'b', status: 'SENDING' }));
    s.dispatches.add({ offerId: 'old', conversationId: 'x1', sessionId: 's1', notBefore: new Date(NOW.getTime() - 120_000) });
    s.dispatches.add({ offerId: 'b', conversationId: 'c1', sessionId: 's1', notBefore: new Date(NOW.getTime() - 60_000) });
    await s.resume.execute({ tenantId: TENANT });
    expect(s.dispatches.items.find((d) => d.conversationId === 'c1')!.notBefore).toEqual(NOW);
  });

  it('libera e compacta a fila de cada sessão a partir de agora, na ordem, sem rajada', async () => {
    const s = setup();
    s.pauses.pausedAt = new Date(NOW.getTime() - 3_600_000);
    s.offers.items.push(makeOffer({ id: 'a', status: 'SENDING' }), makeOffer({ id: 'b', status: 'SENDING' }));
    // envios vencidos durante a pausa (horários no passado), duas sessões
    const past = (m: number) => new Date(NOW.getTime() - m * 60_000);
    s.dispatches.add({ offerId: 'a', conversationId: 'c1', sessionId: 's1', notBefore: past(50) });
    s.dispatches.add({ offerId: 'a', conversationId: 'c2', sessionId: 's1', notBefore: past(48) });
    s.dispatches.add({ offerId: 'b', conversationId: 'c3', sessionId: 's1', notBefore: past(10) });
    s.dispatches.add({ offerId: 'b', conversationId: 'c4', sessionId: 's2', notBefore: past(30) });
    s.dispatches.add({ offerId: 'a', conversationId: 'c0', sessionId: 's1', notBefore: past(70), status: 'SENT', chatMessageId: 'm', claimedAt: past(70) });
    expect(await s.resume.execute({ tenantId: TENANT })).toEqual({ sendingPausedAt: null });
    expect(s.pauses.pausedAt).toBeNull();
    const t = (c: string) => (s.dispatches.items.find((d) => d.conversationId === c)!.notBefore.getTime() - NOW.getTime()) / 1000;
    // s1: 1º agora (último envio foi há 70 min), 2º mantém os 2 min, o buraco de 38 min vira uma folga de 150 s
    expect(t('c1')).toBe(0);
    expect(t('c2')).toBe(120);
    expect(t('c3')).toBe(270);
    // s2: vencido → agora
    expect(t('c4')).toBe(0);
  });
});
