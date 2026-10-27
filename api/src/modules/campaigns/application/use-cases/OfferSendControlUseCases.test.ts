import { describe, it, expect } from 'vitest';
import { CancelOfferUseCase, PauseOfferUseCase, ResumeOfferUseCase } from './OfferSendControlUseCases';
import { ProcessDueOfferDispatchesUseCase } from './ProcessDueOfferDispatchesUseCase';
import {
  InMemoryOfferDispatchRepository,
  InMemoryOfferGeneratorConfigRepository,
  InMemoryOfferRepository,
  makeOffer,
  NOW,
  TENANT,
} from './offerTestFakes';
import type { Offer } from '../../domain/entities/Offer';

const LATER = new Date(NOW.getTime() + 60 * 60_000);
const sec = (s: number) => new Date(LATER.getTime() + s * 1000);

function setup(offer: Partial<Offer> = { status: 'SENDING' }) {
  const offers = new InMemoryOfferRepository();
  offers.items.push(makeOffer(offer));
  const dispatches = new InMemoryOfferDispatchRepository(offers);
  // c1 já saiu, c2 está saindo no worker, c3/c4 na fila (ordem c3 → c4)
  dispatches.add({ offerId: 'offer-1', conversationId: 'c1', status: 'SENT', chatMessageId: 'm1', notBefore: NOW });
  dispatches.add({ offerId: 'offer-1', conversationId: 'c2', status: 'SENDING', claimToken: 'tok', claimedAt: NOW, notBefore: NOW });
  dispatches.add({ offerId: 'offer-1', conversationId: 'c3', notBefore: new Date(NOW.getTime() + 10_000) });
  dispatches.add({ offerId: 'offer-1', conversationId: 'c4', notBefore: new Date(NOW.getTime() + 20_000) });
  const configs = new InMemoryOfferGeneratorConfigRepository([], []);
  configs.configs.set(TENANT, {
    tenantId: TENANT, sessionIds: ['s1'], intervalMinSeconds: 100, intervalMaxSeconds: 200, dispatchOrder: 'SEQUENTIAL', updatedAt: NOW,
  });
  const deps = { offers, dispatches, configs, now: () => LATER, rand: () => 0.5 };
  const byConv = (c: string) => dispatches.items.find((d) => d.conversationId === c)!;
  return { offers, dispatches, deps, byConv, input: { tenantId: TENANT, offerId: 'offer-1' } };
}

describe('PauseOfferUseCase', () => {
  it('SENDING → PAUSED; worker não reivindica mais os QUEUED; o SENDING em curso segue', async () => {
    const { offers, dispatches, deps, input } = setup();
    const out = await new PauseOfferUseCase(deps).execute(input);
    expect(out.status).toBe('PAUSED');
    expect(out.dispatches).toHaveLength(4);
    expect(offers.items[0]!.status).toBe('PAUSED');
    expect(await dispatches.claimDue(new Date(NOW.getTime() + 60_000), 10)).toEqual([]);
    expect(await dispatches.touchClaim('d-2', 'tok')).toBe(true);
  });

  it('fora de SENDING → OFFER_INVALID_STATE', async () => {
    const { deps, input } = setup({ status: 'SENT' });
    await expect(new PauseOfferUseCase(deps).execute(input)).rejects.toMatchObject({ code: 'OFFER_INVALID_STATE' });
  });

  it('pausa com o último envio já saindo: o worker fecha a oferta (SENT) em vez de deixá-la presa em PAUSED', async () => {
    const { offers, dispatches, deps, input } = setup();
    await dispatches.cancelQueued('offer-1', TENANT); // só c2 segue aberto
    await new PauseOfferUseCase(deps).execute(input);
    await dispatches.markResult('d-2', TENANT, 'tok', { status: 'SENT', chatMessageId: 'm2' });
    const sender = { send: async () => ({ chatMessageId: 'x' }) };
    await new ProcessDueOfferDispatchesUseCase({ offers, dispatches, sender, now: () => LATER }).execute();
    expect(offers.items[0]!.status).toBe('SENT');
  });
});

describe('ResumeOfferUseCase', () => {
  it('PAUSED → SENDING; QUEUED reagendados a partir de agora com o intervalo da configuração, mesma ordem', async () => {
    const { deps, byConv, input } = setup({ status: 'PAUSED' });
    const out = await new ResumeOfferUseCase(deps).execute(input);
    expect(out.status).toBe('SENDING');
    // 1º imediato, 2º após 150 s (meio de 100–200); os já enviados/em curso não mudam
    expect(byConv('c3').notBefore).toEqual(sec(0));
    expect(byConv('c4').notBefore).toEqual(sec(150));
    expect(byConv('c1').notBefore).toEqual(NOW);
    expect(byConv('c2').notBefore).toEqual(NOW);
  });

  it('sem configuração usa o intervalo padrão', async () => {
    const { deps, byConv, input } = setup({ status: 'PAUSED' });
    deps.configs.configs.clear();
    await new ResumeOfferUseCase(deps).execute(input);
    expect(byConv('c4').notBefore).toEqual(sec(210));
  });

  it('fora de PAUSED → OFFER_INVALID_STATE', async () => {
    const { deps, input } = setup({ status: 'SENDING' });
    await expect(new ResumeOfferUseCase(deps).execute(input)).rejects.toMatchObject({ code: 'OFFER_INVALID_STATE' });
  });
});

describe('CancelOfferUseCase', () => {
  it.each(['SENDING', 'PAUSED'] as const)('%s → CANCELLED; QUEUED → CANCELLED; SENT e SENDING ficam', async (status) => {
    const { offers, deps, byConv, input } = setup({ status });
    const out = await new CancelOfferUseCase(deps).execute(input);
    expect(out.status).toBe('CANCELLED');
    expect(offers.items[0]!.status).toBe('CANCELLED');
    expect(byConv('c3').status).toBe('CANCELLED');
    expect(byConv('c4').status).toBe('CANCELLED');
    expect(byConv('c1').status).toBe('SENT');
    expect(byConv('c2').status).toBe('SENDING');
  });

  it('o envio em curso termina e a oferta continua CANCELLED (final)', async () => {
    const { offers, dispatches, deps, input } = setup();
    await new CancelOfferUseCase(deps).execute(input);
    await dispatches.markResult('d-2', TENANT, 'tok', { status: 'SENT', chatMessageId: 'm2' });
    const sender = { send: async () => ({ chatMessageId: 'x' }) };
    await new ProcessDueOfferDispatchesUseCase({ offers, dispatches, sender, now: () => LATER }).execute();
    expect(offers.items[0]!.status).toBe('CANCELLED');
  });

  it.each(['DRAFT', 'SENT', 'CANCELLED'] as const)('%s → OFFER_INVALID_STATE', async (status) => {
    const { deps, input } = setup({ status });
    await expect(new CancelOfferUseCase(deps).execute(input)).rejects.toMatchObject({ code: 'OFFER_INVALID_STATE' });
  });
});
