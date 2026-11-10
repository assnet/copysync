import { describe, it, expect, vi } from 'vitest';
import { productRefOf, ResolveProductDataUseCase, EMPTY_PRODUCT_DATA } from './ResolveProductDataUseCase';

function setup() {
  const deps = {
    shopee: { getProduct: vi.fn(), generateShortLink: vi.fn() },
    pageReader: { read: vi.fn().mockResolvedValue({ title: 'X', imageUrl: null, priceCents: 1, originalPriceCents: null, productRef: null }) },
    imageFetcher: { fetch: vi.fn() },
    mediaStore: { saveImage: vi.fn(), consumeUploadedImage: vi.fn(), removeImage: vi.fn() },
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
