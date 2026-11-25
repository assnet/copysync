import { describe, it, expect, vi } from 'vitest';
import { productRefOf, ResolveProductDataUseCase, EMPTY_PRODUCT_DATA } from './ResolveProductDataUseCase';
import { AffiliateApiUnavailableError } from '../../../../shared/errors/internal/OfferErrors';

function setup() {
  const deps = {
    shopee: { getProduct: vi.fn(), generateShortLink: vi.fn() },
    pageReader: { read: vi.fn().mockResolvedValue({ title: 'X', imageUrl: null, priceCents: 1, originalPriceCents: null, productRef: null }) },
    imageFetcher: { fetch: vi.fn() },
    mediaStore: { saveImage: vi.fn(), consumeUploadedImage: vi.fn(), removeImage: vi.fn() },
    kabum: { getProduct: vi.fn() },
  };
  return { deps, uc: new ResolveProductDataUseCase(deps) };
}

describe('ResolveProductDataUseCase — Shein', () => {
  it('productRefOf devolve o goodsId', () => {
    expect(productRefOf({ provider: 'SHEIN', goodsId: '12345678' })).toBe('12345678');
  });

  it('resolve não lê a página e devolve só o productRef', async () => {
    const { deps, uc } = setup();
    const url = new URL('https://br.shein.com/x-p-12345678.html');
    const out = await uc.resolve('SHEIN', { provider: 'SHEIN', goodsId: '12345678' }, url, {
      provider: 'SHEIN',
      publicIdentifier: '1234567890',
      secret: null,
      session: { cookies: { AT: 'T', memberId: '1234567890' } },
    });
    expect(out).toEqual({ ...EMPTY_PRODUCT_DATA, productRef: '12345678' });
    expect(deps.pageReader.read).not.toHaveBeenCalled();
    expect(deps.shopee.getProduct).not.toHaveBeenCalled();
  });

  it('outros marketplaces seguem lendo a página', async () => {
    const { deps, uc } = setup();
    await uc.resolve('AMAZON', { provider: 'AMAZON', asin: 'B0ABCDEFGH' }, new URL('https://www.amazon.com.br/dp/B0ABCDEFGH'), null);
    expect(deps.pageReader.read).toHaveBeenCalledOnce();
  });
});

describe('ResolveProductDataUseCase — Kabum', () => {
  const KP = { title: 'Mouse', priceCents: 16999, originalPriceCents: 19999, imageUrl: 'https://images.kabum.com.br/a.jpg', available: true };
  const AWIN = `https://www.awin1.com/cread.php?awinmid=17729&awinaffid=1234567&ued=${encodeURIComponent('https://www.kabum.com.br/produto/112948')}`;

  it('dados pelo catálogo (link Awin mantido), sem ler a página', async () => {
    const { deps, uc } = setup();
    deps.kabum.getProduct.mockResolvedValue(KP);
    const out = await uc.resolve('KABUM', { provider: 'KABUM', productId: '112948' }, new URL(AWIN), null);
    expect(deps.kabum.getProduct).toHaveBeenCalledWith('112948');
    expect(deps.pageReader.read).not.toHaveBeenCalled();
    expect(out).toEqual({ productRef: '112948', title: 'Mouse', priceCents: 16999, originalPriceCents: 19999, imageSourceUrl: KP.imageUrl });
  });

  it('indisponível, catálogo fora ou sem ref: vazio com o productRef (melhor esforço); erro inesperado sobe', async () => {
    const { deps, uc } = setup();
    const ref = { provider: 'KABUM', productId: '112948' } as const;
    deps.kabum.getProduct.mockResolvedValueOnce(null);
    expect(await uc.resolve('KABUM', ref, new URL(AWIN), null)).toEqual({ ...EMPTY_PRODUCT_DATA, productRef: '112948' });
    deps.kabum.getProduct.mockRejectedValueOnce(new AffiliateApiUnavailableError('KABUM'));
    expect(await uc.resolve('KABUM', ref, new URL(AWIN), null)).toEqual({ ...EMPTY_PRODUCT_DATA, productRef: '112948' });
    expect(await uc.resolve('KABUM', null, new URL('https://www.kabum.com.br/'), null)).toEqual(EMPTY_PRODUCT_DATA);
    deps.kabum.getProduct.mockRejectedValueOnce(new TypeError('bug'));
    await expect(uc.resolve('KABUM', ref, new URL(AWIN), null)).rejects.toThrow('bug');
    expect(deps.pageReader.read).not.toHaveBeenCalled();
  });
});
