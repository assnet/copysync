import { describe, it, expect, vi } from 'vitest';
import { UpdateOfferUseCase } from './UpdateOfferUseCase';
import { InMemoryOfferRepository, makeOffer, TENANT, USER } from './offerTestFakes';
import type { OfferStatus } from '../../domain/enums/OfferStatus';

function setup(status: OfferStatus = 'DRAFT', textEdited = false) {
  const offers = new InMemoryOfferRepository();
  offers.items.push(makeOffer({ status, textEdited, text: textEdited ? 'meu texto' : makeOffer().text }));
  const mediaStore = {
    saveImage: vi.fn(),
    consumeUploadedImage: vi.fn().mockResolvedValue('store://up/1.jpg'),
    removeImage: vi.fn().mockResolvedValue(undefined),
  };
  return { offers, mediaStore, uc: new UpdateOfferUseCase({ offers, mediaStore }) };
}

const base = { tenantId: TENANT, userId: USER, offerId: 'offer-1' };

describe('UpdateOfferUseCase', () => {
  it('preço/título com texto não editado → remonta o texto', async () => {
    const s = setup();
    const dto = await s.uc.execute({ ...base, title: ' Fone ', priceCents: 5000, originalPriceCents: 10000 });
    expect(dto).toMatchObject({ title: 'Fone', priceCents: 5000, textEdited: false });
    expect(dto.text).toContain('🔥 Fone');
    expect(dto.text).toContain('50% OFF');
  });

  it('texto editado à mão: preço muda sem remontar', async () => {
    const s = setup('DRAFT', true);
    const dto = await s.uc.execute({ ...base, priceCents: 5000 });
    expect(dto).toMatchObject({ priceCents: 5000, text: 'meu texto', textEdited: true });
  });

  it('texto enviado → grava e marca textEdited', async () => {
    const s = setup();
    const dto = await s.uc.execute({ ...base, text: 'novo', priceCents: 100 });
    expect(dto).toMatchObject({ text: 'novo', textEdited: true, priceCents: 100 });
  });

  it('sem mudança de dado do texto: não remonta', async () => {
    const s = setup();
    const before = s.offers.items[0]!.text;
    await s.uc.execute({ ...base, imageUploadId: 'up-1' });
    expect(s.offers.items[0]!.text).toBe(before);
  });

  it('imageUploadId → consome upload e grava imageUrl', async () => {
    const s = setup();
    const dto = await s.uc.execute({ ...base, imageUploadId: 'up-1' });
    expect(s.mediaStore.consumeUploadedImage).toHaveBeenCalledWith({ tenantId: TENANT, userId: USER, uploadId: 'up-1' });
    expect(dto.imageUrl).toBe('store://up/1.jpg');
  });

  it.each([
    [{ text: 'x'.repeat(4097) }, 'text'],
    [{ text: '   ' }, 'text'],
    [{ title: 't'.repeat(301) }, 'title'],
    [{ priceCents: -1 }, 'priceCents'],
    [{ originalPriceCents: 1.5 }, 'originalPriceCents'],
  ])('entrada inválida %o → 422', async (patch, field) => {
    const s = setup();
    await expect(s.uc.execute({ ...base, ...patch })).rejects.toMatchObject({ statusCode: 422, meta: { field } });
  });

  it('texto de 4096 aceito', async () => {
    const s = setup();
    await expect(s.uc.execute({ ...base, text: 'x'.repeat(4096) })).resolves.toBeDefined();
  });

  it('oferta inexistente → OFFER_NOT_FOUND', async () => {
    const s = setup();
    await expect(s.uc.execute({ ...base, offerId: 'nope' })).rejects.toMatchObject({ code: 'OFFER_NOT_FOUND' });
  });

  it('outro tenant → OFFER_NOT_FOUND', async () => {
    const s = setup();
    await expect(s.uc.execute({ ...base, tenantId: 'other' })).rejects.toMatchObject({ code: 'OFFER_NOT_FOUND' });
  });

  it('oferta SENDING → OFFER_ALREADY_SENT sem consumir upload', async () => {
    const s = setup('SENDING');
    await expect(s.uc.execute({ ...base, imageUploadId: 'up-1' })).rejects.toMatchObject({ code: 'OFFER_ALREADY_SENT' });
    expect(s.mediaStore.consumeUploadedImage).not.toHaveBeenCalled();
  });

  it('corrida: repo devolve not_editable → OFFER_ALREADY_SENT', async () => {
    const s = setup();
    vi.spyOn(s.offers, 'update').mockResolvedValueOnce({ outcome: 'not_editable' });
    await expect(s.uc.execute({ ...base, title: 'x' })).rejects.toMatchObject({ code: 'OFFER_ALREADY_SENT' });
  });

  it('foto trocada → apaga a anterior; sem foto anterior nada é apagado', async () => {
    const s = setup();
    await s.uc.execute({ ...base, imageUploadId: 'up-1' });
    expect(s.mediaStore.removeImage).not.toHaveBeenCalled();
    s.mediaStore.consumeUploadedImage.mockResolvedValueOnce('store://up/2.jpg');
    await s.uc.execute({ ...base, imageUploadId: 'up-2' });
    expect(s.mediaStore.removeImage).toHaveBeenCalledWith('store://up/1.jpg');
  });

  it('update falha depois de salvar a foto → apaga a foto nova', async () => {
    const s = setup();
    vi.spyOn(s.offers, 'update').mockResolvedValueOnce({ outcome: 'not_editable' });
    await expect(s.uc.execute({ ...base, imageUploadId: 'up-1' })).rejects.toMatchObject({ code: 'OFFER_ALREADY_SENT' });
    expect(s.mediaStore.removeImage).toHaveBeenCalledWith('store://up/1.jpg');

    vi.spyOn(s.offers, 'update').mockRejectedValueOnce(new Error('db'));
    s.mediaStore.removeImage.mockRejectedValueOnce(new Error('rm'));
    await expect(s.uc.execute({ ...base, imageUploadId: 'up-1' })).rejects.toThrow('db');
  });
});
