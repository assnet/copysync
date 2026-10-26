import { describe, it, expect, vi } from 'vitest';
import { RegenerateOfferTextUseCase } from './RegenerateOfferTextUseCase';
import { InMemoryOfferRepository, makeOffer, TENANT } from './offerTestFakes';
import { OfferTextComposer } from '../services/OfferTextComposer';
import { AppError } from '../../../../shared/errors/AppError';
import type { Offer } from '../../domain/entities/Offer';

const LINK = 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=t-20';

function setup(overrides: Partial<Offer> = {}) {
  const offers = new InMemoryOfferRepository();
  offers.items.push(makeOffer({ title: 'Ração 10kg', priceCents: 9990, textEdited: true, text: 'meu texto', ...overrides }));
  const ai = { generate: vi.fn().mockResolvedValue({ text: `Seu pet vai amar 🐾\n${LINK}` }) };
  return { offers, ai, uc: new RegenerateOfferTextUseCase({ offers, texts: new OfferTextComposer(ai) }) };
}

const input = { tenantId: TENANT, offerId: 'offer-1' };

describe('RegenerateOfferTextUseCase', () => {
  it('troca o público, gera pela IA e zera textEdited', async () => {
    const s = setup();
    const out = await s.uc.execute({ ...input, audience: 'PET' });
    expect(out).toMatchObject({ aiFallback: false, offer: { audience: 'PET', textEdited: false, text: `Seu pet vai amar 🐾\n${LINK}` } });
    expect(out.aiErrorCode).toBeUndefined();
  });

  it('STANDARD → modelo fixo, sem IA', async () => {
    const s = setup();
    const out = await s.uc.execute(input);
    expect(s.ai.generate).not.toHaveBeenCalled();
    expect(out.offer.text).toContain('🔥 Ração 10kg');
  });

  it('IA indisponível → modelo + aiFallback/aiErrorCode', async () => {
    const s = setup({ audience: 'MOMS' });
    s.ai.generate.mockRejectedValueOnce(new AppError('AI_DAILY_LIMIT_REACHED', 'x', 429));
    const out = await s.uc.execute(input);
    expect(out).toMatchObject({ aiFallback: true, aiErrorCode: 'AI_DAILY_LIMIT_REACHED', offer: { audience: 'MOMS' } });
    expect(out.offer.text).toContain(LINK);
  });

  it.each(['SENDING', 'SENT', 'FAILED'] as const)('oferta %s → OFFER_ALREADY_SENT sem chamar IA', async (status) => {
    const s = setup({ status, audience: 'PET' });
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'OFFER_ALREADY_SENT' });
    expect(s.ai.generate).not.toHaveBeenCalled();
  });

  it('oferta de outro tenant → OFFER_NOT_FOUND', async () => {
    const s = setup();
    await expect(s.uc.execute({ ...input, tenantId: 'outro' })).rejects.toMatchObject({ code: 'OFFER_NOT_FOUND' });
  });

  it('oferta editada durante a chamada à IA → OFFER_CHANGED sem sobrescrever', async () => {
    const s = setup({ audience: 'PET' });
    s.ai.generate.mockImplementationOnce(async () => {
      await s.offers.update('offer-1', TENANT, { text: 'editado no meio' });
      return { text: `Seu pet vai amar 🐾\n${LINK}` };
    });
    await expect(s.uc.execute(input)).rejects.toMatchObject({ code: 'OFFER_CHANGED', statusCode: 409 });
    expect((await s.offers.findById('offer-1', TENANT))!.text).toBe('editado no meio');
  });

  it('IA com links estranhos demais → modelo fixo (AI_RESPONSE_INVALID)', async () => {
    const s = setup({ audience: 'PET' });
    s.ai.generate.mockResolvedValueOnce({ text: `a https://x.com/1 b meli.la/2 c amzn.to/3 ${LINK}` });
    const out = await s.uc.execute(input);
    expect(out).toMatchObject({ aiFallback: true, aiErrorCode: 'AI_RESPONSE_INVALID' });
    expect(out.offer.text).toContain('🔥 Ração 10kg');
  });

  it('IA com link estranho isolado: removido, link exato mantido', async () => {
    const s = setup({ audience: 'PET' });
    s.ai.generate.mockResolvedValueOnce({ text: `Oferta! compre em amzn.to/xyz\n${LINK}` });
    const out = await s.uc.execute(input);
    expect(out.offer.text).toBe(`Oferta! compre em\n${LINK}`);
  });
});
