import { describe, it, expect } from 'vitest';
import { SendOfferUseCase } from './SendOfferUseCase';
import {
  InMemoryOfferDestinationRepository,
  InMemoryOfferDispatchRepository,
  InMemoryOfferRepository,
  makeOffer,
  NOW,
  TENANT,
} from './offerTestFakes';
import type { OfferStatus } from '../../domain/enums/OfferStatus';

function setup(status: OfferStatus = 'DRAFT', selected = ['c1', 'c2', 'c3']) {
  const offers = new InMemoryOfferRepository();
  offers.items.push(makeOffer({ status }));
  const dispatches = new InMemoryOfferDispatchRepository(offers);
  const destinations = new InMemoryOfferDestinationRepository({ [TENANT]: ['c1', 'c2', 'c3'] });
  destinations.selected = selected;
  const uc = new SendOfferUseCase({
    offers, dispatches, destinations, now: () => NOW, rand: () => 0.5, interval: { minMs: 8000, maxMs: 16000 },
  });
  return { offers, dispatches, uc };
}

const input = { tenantId: TENANT, offerId: 'offer-1' };

describe('SendOfferUseCase', () => {
  it('DRAFT → SENDING com um envio QUEUED por destino, espaçados', async () => {
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

  it('sem destinos → OFFER_NO_DESTINATIONS e oferta segue DRAFT', async () => {
    const s = setup('DRAFT', []);
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'OFFER_NO_DESTINATIONS', statusCode: 422 });
    expect(s.offers.items[0]!.status).toBe('DRAFT');
  });

  it.each(['SENDING', 'SENT', 'FAILED'] as const)('oferta %s → OFFER_ALREADY_SENT', async (status) => {
    const s = setup(status);
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
    s.dispatches.startSending = async () => null;
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'OFFER_ALREADY_SENT' });
  });

  it('oferta inexistente → OFFER_NOT_FOUND', async () => {
    const s = setup();
    await expect(s.uc.execute({ ...input, offerId: 'x' })).rejects.toMatchObject({ code: 'OFFER_NOT_FOUND' });
  });
});
