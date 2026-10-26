import { describe, it, expect, vi } from 'vitest';
import { GenerateOfferUseCase, type GenerateOfferDeps } from './GenerateOfferUseCase';
import { InMemoryOfferRepository, makeOffer, NOW, TENANT, USER } from './offerTestFakes';
import type { IShopeeAffiliateClient, ShopeeProduct } from '../../domain/contracts/IShopeeAffiliateClient';
import type { OfferAffiliateCredential } from '../../domain/contracts/IAffiliateCredentialResolver';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import { OfferUrlUnsupportedError, AffiliateApiUnavailableError } from '../../../../shared/errors/internal/OfferErrors';

const SHOPEE_PRODUCT: ShopeeProduct = {
  title: 'Fone Bluetooth',
  imageUrl: 'https://down-br.img.susercontent.com/file/abc',
  priceCents: 4990,
  originalPriceCents: 9990,
  offerLink: 'https://shopee.com.br/product/123/456?aff=1',
};

const CREDS: Record<AffiliateProvider, OfferAffiliateCredential> = {
  SHOPEE: { provider: 'SHOPEE', publicIdentifier: '18301234567', secret: 'S3CR3T' },
  AMAZON: { provider: 'AMAZON', publicIdentifier: 'loja-20', secret: null },
  MERCADO_LIVRE: { provider: 'MERCADO_LIVRE', publicIdentifier: 'minhaetq', secret: null },
};

function setup(opts: { limit?: number | null; creds?: Partial<Record<AffiliateProvider, OfferAffiliateCredential>> } = {}) {
  const offers = new InMemoryOfferRepository();
  const shopee = {
    getProduct: vi.fn().mockResolvedValue(SHOPEE_PRODUCT),
    generateShortLink: vi.fn().mockResolvedValue('https://s.shopee.com.br/abc'),
  } satisfies IShopeeAffiliateClient;
  const deps = {
    offers,
    entitlements: { getNumber: vi.fn().mockResolvedValue(opts.limit ?? null) },
    expander: { expand: vi.fn(async (u: URL) => u) },
    credentials: { execute: vi.fn(async (_t: string, p: AffiliateProvider) => (opts.creds ?? CREDS)[p] ?? null) },
    shopee,
    imageFetcher: { fetch: vi.fn().mockResolvedValue({ buffer: Buffer.from('img'), mimeType: 'image/jpeg' }) },
    mediaStore: { saveImage: vi.fn().mockResolvedValue('store://offers/1.jpg'), consumeUploadedImage: vi.fn(), removeImage: vi.fn() },
    now: () => NOW,
  } satisfies GenerateOfferDeps;
  return { deps, offers, uc: new GenerateOfferUseCase(deps) };
}

const run = (s: ReturnType<typeof setup>, url: string) => s.uc.execute({ tenantId: TENANT, userId: USER, url });
const errorOf = (p: Promise<unknown>) => p.catch((e: unknown) => e);

describe('GenerateOfferUseCase — limite diário', () => {
  it('limite atingido no dia → PLAN_LIMIT_REACHED com meta, sem chamar marketplace', async () => {
    const s = setup({ limit: 2 });
    s.offers.items.push(makeOffer({ id: 'a' }), makeOffer({ id: 'b' }));
    const err = await errorOf(run(s, 'https://amazon.com.br/dp/B0ABCDEFGH'));
    expect(err).toMatchObject({ code: 'PLAN_LIMIT_REACHED', statusCode: 403, meta: { key: 'offer_generations_per_day', limit: 2 } });
    expect(s.deps.expander.expand).not.toHaveBeenCalled();
  });

  it('cota esgotada entre a checagem e a gravação → PLAN_LIMIT_REACHED, nada gravado', async () => {
    const s = setup({ limit: 1 });
    // Outra geração concorrente grava enquanto esta consulta o marketplace
    s.deps.expander.expand.mockImplementationOnce(async (u: URL) => {
      s.offers.items.push(makeOffer({ id: 'concorrente' }));
      return u;
    });
    const err = await errorOf(run(s, 'https://amazon.com.br/dp/B0ABCDEFGH'));
    expect(err).toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    expect(s.offers.items).toHaveLength(1);
  });

  it('ofertas de ontem não contam', async () => {
    const s = setup({ limit: 1 });
    s.offers.items.push(makeOffer({ createdAt: new Date('2026-10-25T12:00:00Z') }));
    await expect(run(s, 'https://amazon.com.br/dp/B0ABCDEFGH')).resolves.toBeDefined();
  });

  it('entitlement null = ilimitado', async () => {
    const s = setup({ limit: null });
    for (let i = 0; i < 50; i++) s.offers.items.push(makeOffer({ id: `x${i}` }));
    await expect(run(s, 'https://amazon.com.br/dp/B0ABCDEFGH')).resolves.toBeDefined();
  });
});

describe('GenerateOfferUseCase — URL', () => {
  it.each([
    'https://evil.com/dp/B0ABCDEFGH',
    'http://amazon.com.br/dp/B0ABCDEFGH',
    'https://user:pass@amazon.com.br/dp/B0ABCDEFGH',
    'https://amazon.com.br:8443/dp/B0ABCDEFGH',
    'não é url',
  ])('%s → OFFER_URL_UNSUPPORTED sem requisição', async (url) => {
    const s = setup();
    const err = await errorOf(run(s, url));
    expect(err).toMatchObject({ code: 'OFFER_URL_UNSUPPORTED', statusCode: 422 });
    expect(s.deps.expander.expand).not.toHaveBeenCalled();
    expect(s.offers.items).toHaveLength(0);
  });

  it('redirect para fora da allowlist propaga o erro do expander', async () => {
    const s = setup();
    s.deps.expander.expand.mockRejectedValueOnce(new OfferUrlUnsupportedError());
    await expect(run(s, 'https://amzn.to/abc')).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
  });

  it('produto não reconhecido na URL final', async () => {
    const s = setup();
    await expect(run(s, 'https://amazon.com.br/s?k=fone')).rejects.toMatchObject({
      code: 'OFFER_URL_UNSUPPORTED',
      message: 'Product not recognized',
    });
  });

  it('link curto: usa a URL expandida', async () => {
    const s = setup();
    s.deps.expander.expand.mockResolvedValueOnce(new URL('https://www.amazon.com.br/dp/B0ZZZZZZZZ?ref=x'));
    const { offer } = await run(s, 'https://amzn.to/abc');
    expect(offer.affiliateUrl).toBe('https://www.amazon.com.br/dp/B0ZZZZZZZZ?tag=loja-20');
    expect(offer.sourceUrl).toBe('https://amzn.to/abc');
  });
});

describe('GenerateOfferUseCase — credencial', () => {
  it('sem credencial ativa → AFFILIATE_CREDENTIAL_NOT_FOUND, nada gravado', async () => {
    const s = setup({ creds: {} });
    const err = await errorOf(run(s, 'https://shopee.com.br/x-i.123.456'));
    expect(err).toMatchObject({ code: 'AFFILIATE_CREDENTIAL_NOT_FOUND', statusCode: 404 });
    expect(s.offers.items).toHaveLength(0);
  });
});

describe('GenerateOfferUseCase — Shopee', () => {
  it('caminho feliz: produto, link curto, foto no store, texto montado', async () => {
    const s = setup();
    const out = await run(s, 'https://shopee.com.br/fone-i.123.456');

    expect(s.deps.shopee.getProduct).toHaveBeenCalledWith(
      { appId: '18301234567', secret: 'S3CR3T' },
      { shopId: '123', itemId: '456' },
    );
    expect(s.deps.shopee.generateShortLink).toHaveBeenCalledWith(expect.anything(), SHOPEE_PRODUCT.offerLink);
    expect(out.needsManualData).toBe(false);
    expect(out.offer).toMatchObject({
      provider: 'SHOPEE', status: 'DRAFT', productRef: '123.456', title: 'Fone Bluetooth', priceCents: 4990,
      originalPriceCents: 9990, imageUrl: 'store://offers/1.jpg', affiliateUrl: 'https://s.shopee.com.br/abc',
      attributionVerified: true,
    });
    expect(out.offer.text).toContain('🔥 Fone Bluetooth');
    expect(out.offer.text).toContain('50% OFF');
    expect(out.offer.text).toContain('https://s.shopee.com.br/abc');
    expect(s.offers.items[0]!.createdById).toBe(USER);
    expect(JSON.stringify(out)).not.toContain('S3CR3T');
  });

  it('sem offerLink: link curto da URL canônica', async () => {
    const s = setup();
    s.deps.shopee.getProduct.mockResolvedValueOnce({ ...SHOPEE_PRODUCT, offerLink: null });
    await run(s, 'https://shopee.com.br/fone-i.123.456');
    expect(s.deps.shopee.generateShortLink).toHaveBeenCalledWith(expect.anything(), 'https://shopee.com.br/product/123/456');
  });

  it('foto não baixa → oferta sem foto, sem erro', async () => {
    const s = setup();
    s.deps.imageFetcher.fetch.mockResolvedValueOnce(null);
    expect((await run(s, 'https://shopee.com.br/fone-i.123.456')).offer.imageUrl).toBeNull();
  });

  it('store falha → oferta sem foto, sem erro', async () => {
    const s = setup();
    s.deps.mediaStore.saveImage.mockRejectedValueOnce(new Error('disk'));
    const out = await run(s, 'https://shopee.com.br/fone-i.123.456');
    expect(out.offer.imageUrl).toBeNull();
    expect(s.offers.items).toHaveLength(1);
  });

  it('produto não encontrado → OFFER_PRODUCT_NOT_FOUND', async () => {
    const s = setup();
    s.deps.shopee.getProduct.mockResolvedValueOnce(null);
    await expect(run(s, 'https://shopee.com.br/fone-i.123.456')).rejects.toMatchObject({ code: 'OFFER_PRODUCT_NOT_FOUND' });
    expect(s.offers.items).toHaveLength(0);
  });

  it('API indisponível → erro propagado e nada gravado nem contado', async () => {
    const s = setup({ limit: 5 });
    s.deps.shopee.generateShortLink.mockRejectedValueOnce(new AffiliateApiUnavailableError('SHOPEE'));
    await expect(run(s, 'https://shopee.com.br/fone-i.123.456')).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
    expect(s.offers.items).toHaveLength(0);
  });
});

describe('GenerateOfferUseCase — Amazon e Mercado Livre', () => {
  it('Amazon: link com tag, produto vazio, needsManualData', async () => {
    const s = setup();
    const out = await run(s, 'https://www.amazon.com.br/Fone/dp/B0ABCDEFGH/ref=sr_1?tag=outro-20');
    expect(out.needsManualData).toBe(true);
    expect(out.offer).toMatchObject({
      provider: 'AMAZON', affiliateUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=loja-20',
      title: null, priceCents: null, imageUrl: null, attributionVerified: true,
    });
    expect(s.deps.shopee.getProduct).not.toHaveBeenCalled();
  });

  it('Mercado Livre: matt_word, sem rastreio de origem, attributionVerified=false', async () => {
    const s = setup();
    const out = await run(s, 'https://produto.mercadolivre.com.br/MLB-123456-fone?matt_tool=99#x');
    expect(out.needsManualData).toBe(true);
    expect(out.offer).toMatchObject({
      provider: 'MERCADO_LIVRE', productRef: 'MLB123456', attributionVerified: false,
      affiliateUrl: 'https://produto.mercadolivre.com.br/MLB-123456-fone?matt_word=minhaetq',
    });
  });
});
