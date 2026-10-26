import { describe, it, expect } from 'vitest';
import { GetOfferUseCase } from './GetOfferUseCase';
import { GetOfferUsageUseCase } from './GetOfferUsageUseCase';
import { InMemoryOfferDispatchRepository, InMemoryOfferRepository, makeOffer, NOW, TENANT } from './offerTestFakes';

describe('GetOfferUseCase', () => {
  it('oferta + envios com datas ISO', async () => {
    const offers = new InMemoryOfferRepository();
    offers.items.push(makeOffer());
    const dispatches = new InMemoryOfferDispatchRepository(offers);
    dispatches.add({ offerId: 'offer-1', conversationId: 'c1' });
    const dto = await new GetOfferUseCase(offers, dispatches).execute({ tenantId: TENANT, offerId: 'offer-1' });
    expect(dto.createdAt).toBe(NOW.toISOString());
    expect(dto.dispatches).toEqual([expect.objectContaining({ conversationId: 'c1', status: 'QUEUED' })]);
    expect(dto).not.toHaveProperty('tenantId');
  });

  it('outro tenant → OFFER_NOT_FOUND', async () => {
    const offers = new InMemoryOfferRepository();
    offers.items.push(makeOffer());
    const uc = new GetOfferUseCase(offers, new InMemoryOfferDispatchRepository(offers));
    await expect(uc.execute({ tenantId: 'other', offerId: 'offer-1' })).rejects.toMatchObject({ code: 'OFFER_NOT_FOUND' });
  });
});

describe('GetOfferUsageUseCase', () => {
  it.each([[3], [null]])('used do dia + limit %s', async (limit) => {
    const offers = new InMemoryOfferRepository();
    offers.items.push(makeOffer({ id: 'a' }), makeOffer({ id: 'b', createdAt: new Date('2026-10-25T10:00:00Z') }));
    const uc = new GetOfferUsageUseCase(offers, { getNumber: async () => limit }, () => NOW);
    expect(await uc.execute(TENANT)).toEqual({ used: 1, limit });
  });
});
