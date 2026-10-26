import { describe, it, expect, vi } from 'vitest';
import { GenerateOfferUseCase, type GenerateOfferDeps } from './GenerateOfferUseCase';
import { FakeEntitlementReader, InMemoryOfferRepository, makeOffer, NOW, TENANT, USER } from './offerTestFakes';
import { OfferTextComposer } from '../services/OfferTextComposer';
import type { IShopeeAffiliateClient, ShopeeProduct } from '../../domain/contracts/IShopeeAffiliateClient';
import type { OfferAffiliateCredential } from '../../domain/contracts/IAffiliateCredentialResolver';
import type { ProductPageData } from '../../domain/services/parseProductPage';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import { AppError } from '../../../../shared/errors/AppError';
import { OfferUrlUnsupportedError, AffiliateApiUnavailableError } from '../../../../shared/errors/internal/OfferErrors';

const SHOPEE_PRODUCT: ShopeeProduct = {
  title: 'Fone Bluetooth',
  imageUrl: 'https://down-br.img.susercontent.com/file/abc',
  priceCents: 4990,
  originalPriceCents: 9990,
  offerLink: 'https://shopee.com.br/product/123/456?aff=1',
};

const PAGE: ProductPageData = {
  title: 'Air Fryer 4L',
  imageUrl: 'https://http2.mlstatic.com/D_NQ_NP_1.jpg',
  priceCents: 29990,
  originalPriceCents: 39990,
  productRef: null,
};

const CREDS: Record<AffiliateProvider, OfferAffiliateCredential> = {
  SHOPEE: { provider: 'SHOPEE', publicIdentifier: '18301234567', secret: 'S3CR3T' },
  AMAZON: { provider: 'AMAZON', publicIdentifier: 'loja-20', secret: null },
  MERCADO_LIVRE: { provider: 'MERCADO_LIVRE', publicIdentifier: 'minhaetq', secret: null, session: { sessionToken: 'SSID-TOKEN' } },
};

function setup(opts: { limit?: number | null; creds?: Partial<Record<AffiliateProvider, OfferAffiliateCredential>> } = {}) {
  const offers = new InMemoryOfferRepository();
  const shopee = {
    getProduct: vi.fn().mockResolvedValue(SHOPEE_PRODUCT),
    generateShortLink: vi.fn(),
  } satisfies IShopeeAffiliateClient;
  const ai = { generate: vi.fn().mockResolvedValue({ text: 'Texto da IA 💜\nhttps://amzn.to/abc' }) };
  const deps = {
    offers,
    entitlements: new FakeEntitlementReader(opts.limit != null ? { offer_generations_per_day: opts.limit } : {}),
    expander: { expand: vi.fn(async (u: URL) => u) },
    credentials: { execute: vi.fn(async (_t: string, p: AffiliateProvider) => (opts.creds ?? CREDS)[p] ?? null) },
    shopee,
    pageReader: { read: vi.fn().mockResolvedValue(PAGE) },
    imageFetcher: { fetch: vi.fn().mockResolvedValue({ buffer: Buffer.from('img'), mimeType: 'image/jpeg' }) },
    mediaStore: { saveImage: vi.fn().mockResolvedValue('store://offers/1.jpg'), consumeUploadedImage: vi.fn(), removeImage: vi.fn() },
    texts: new OfferTextComposer(ai),
    now: () => NOW,
  } satisfies GenerateOfferDeps;
  return { deps, offers, ai, uc: new GenerateOfferUseCase(deps) };
}

const AMAZON = 'https://www.amazon.com.br/Fone/dp/B0ABCDEFGH/ref=sr_1?tag=loja-20';
const run = (s: ReturnType<typeof setup>, url: string, extra: { coupon?: string | null; audience?: 'STANDARD' | 'PET' } = {}) =>
  s.uc.execute({ tenantId: TENANT, userId: USER, url, ...extra });
const errorOf = (p: Promise<unknown>) => p.catch((e: unknown) => e);

describe('GenerateOfferUseCase — limite diário', () => {
  it('limite atingido no dia → PLAN_LIMIT_REACHED com meta, sem chamar marketplace', async () => {
    const s = setup({ limit: 2 });
    s.offers.items.push(makeOffer({ id: 'a' }), makeOffer({ id: 'b' }));
    const err = await errorOf(run(s, AMAZON));
    expect(err).toMatchObject({ code: 'PLAN_LIMIT_REACHED', statusCode: 403, meta: { key: 'offer_generations_per_day', limit: 2 } });
    expect(s.deps.expander.expand).not.toHaveBeenCalled();
  });

  it('cota esgotada entre a checagem e a gravação → PLAN_LIMIT_REACHED, nada gravado, foto descartada', async () => {
    const s = setup({ limit: 1 });
    s.deps.expander.expand.mockImplementationOnce(async (u: URL) => {
      s.offers.items.push(makeOffer({ id: 'concorrente' }));
      return u;
    });
    const err = await errorOf(run(s, AMAZON));
    expect(err).toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    expect(s.offers.items).toHaveLength(1);
    expect(s.deps.mediaStore.removeImage).toHaveBeenCalledWith('store://offers/1.jpg');
  });

  it('ofertas de ontem não contam; entitlement ausente = ilimitado', async () => {
    const s = setup({ limit: 1 });
    s.offers.items.push(makeOffer({ createdAt: new Date('2026-10-25T12:00:00Z') }));
    await expect(run(s, AMAZON)).resolves.toBeDefined();
    const u = setup();
    for (let i = 0; i < 50; i++) u.offers.items.push(makeOffer({ id: `x${i}` }));
    await expect(run(u, AMAZON)).resolves.toBeDefined();
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
    expect(s.deps.pageReader.read).not.toHaveBeenCalled();
    expect(s.offers.items).toHaveLength(0);
  });

  it('redirect para fora da allowlist propaga o erro do expander', async () => {
    const s = setup();
    s.deps.expander.expand.mockRejectedValueOnce(new OfferUrlUnsupportedError());
    await expect(run(s, 'https://amzn.to/abc')).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
  });

  it('produto não reconhecido na URL final', async () => {
    const s = setup();
    await expect(run(s, 'https://amazon.com.br/s?k=fone&tag=loja-20')).rejects.toMatchObject({
      code: 'OFFER_URL_UNSUPPORTED',
      message: 'Product not recognized',
    });
  });

  it('cupom inválido → OFFER_INVALID_INPUT (coupon) sem rede', async () => {
    const s = setup();
    await expect(run(s, AMAZON, { coupon: 'A;B<script>' })).rejects.toMatchObject({ code: 'OFFER_INVALID_INPUT', meta: { field: 'coupon' } });
    expect(s.deps.expander.expand).not.toHaveBeenCalled();
  });
});

describe('GenerateOfferUseCase — link colado é o link de afiliado', () => {
  it('Amazon curto: affiliateUrl = link colado; dono conferido na URL expandida', async () => {
    const s = setup();
    s.deps.expander.expand.mockResolvedValueOnce(new URL('https://www.amazon.com.br/dp/B0ZZZZZZZZ?tag=LOJA-20&ref=x'));
    const { offer } = await run(s, 'https://amzn.to/abc');
    expect(offer).toMatchObject({
      affiliateUrl: 'https://amzn.to/abc', sourceUrl: 'https://amzn.to/abc', productRef: 'B0ZZZZZZZZ', attributionVerified: true,
    });
    expect(s.deps.shopee.generateShortLink).not.toHaveBeenCalled();
  });

  it('Amazon com tag de outra conta → OFFER_LINK_NOT_OWNED, nada gravado', async () => {
    const s = setup();
    const err = await errorOf(run(s, 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=outro-20'));
    expect(err).toMatchObject({ code: 'OFFER_LINK_NOT_OWNED', statusCode: 422, meta: { provider: 'AMAZON' } });
    expect(JSON.stringify(err)).not.toContain('outro-20');
    expect(s.offers.items).toHaveLength(0);
    expect(s.deps.pageReader.read).not.toHaveBeenCalled();
  });

  it('Amazon sem tag → OFFER_LINK_NOT_AFFILIATE (mesmo sem credencial)', async () => {
    const s = setup({ creds: {} });
    await expect(run(s, 'https://www.amazon.com.br/dp/B0ABCDEFGH')).rejects.toMatchObject({ code: 'OFFER_LINK_NOT_AFFILIATE', statusCode: 422 });
  });

  it('sem credencial do marketplace: não bloqueia, attributionVerified=false', async () => {
    const s = setup({ creds: {} });
    const { offer } = await run(s, AMAZON);
    expect(offer.attributionVerified).toBe(false);
  });

  it('ML: matt_word do tenant → verificado; página lida com cookie da sessão', async () => {
    const s = setup();
    const url = 'https://produto.mercadolivre.com.br/MLB-123456-fone?matt_word=minhaetq&matt_tool=1';
    const out = await run(s, url);
    expect(out.offer).toMatchObject({ provider: 'MERCADO_LIVRE', productRef: 'MLB123456', attributionVerified: true, affiliateUrl: url });
    expect(s.deps.pageReader.read).toHaveBeenCalledWith({ url: new URL(url), mercadoLivreSessionToken: 'SSID-TOKEN' });
    expect(JSON.stringify(out)).not.toContain('SSID-TOKEN');
  });

  it('ML: matt_word de outra etiqueta → OFFER_LINK_NOT_OWNED; sem matt_word → NOT_AFFILIATE', async () => {
    const s = setup();
    await expect(run(s, 'https://produto.mercadolivre.com.br/MLB-1-x?matt_word=outra')).rejects.toMatchObject({ code: 'OFFER_LINK_NOT_OWNED' });
    await expect(run(s, 'https://produto.mercadolivre.com.br/MLB-1-x')).rejects.toMatchObject({ code: 'OFFER_LINK_NOT_AFFILIATE' });
  });

  it('meli.la → página social: link colado mantido; produto pelo product_id da página', async () => {
    const s = setup();
    s.deps.expander.expand.mockResolvedValueOnce(
      new URL('https://www.mercadolivre.com.br/social/minhaetq?matt_word=minhaetq&matt_tool=63844234'),
    );
    s.deps.pageReader.read.mockResolvedValueOnce({ ...PAGE, productRef: 'MLB999' });
    const out = await run(s, 'https://meli.la/1Hb6zu6');
    expect(out.offer).toMatchObject({
      provider: 'MERCADO_LIVRE', productRef: 'MLB999', attributionVerified: true, affiliateUrl: 'https://meli.la/1Hb6zu6',
      title: 'Air Fryer 4L', priceCents: 29990,
    });
    expect(out.needsManualData).toBe(false);
  });

  it('página social sem matt_word: etiqueta do path vale', async () => {
    const s = setup();
    s.deps.expander.expand.mockResolvedValueOnce(new URL('https://www.mercadolivre.com.br/social/outra'));
    await expect(run(s, 'https://meli.la/xyz')).rejects.toMatchObject({ code: 'OFFER_LINK_NOT_OWNED' });
  });
});

describe('GenerateOfferUseCase — dados do produto', () => {
  it('Shopee com secret: Open API, link colado, sem verificação de dono', async () => {
    const s = setup();
    const out = await run(s, 'https://shopee.com.br/fone-i.123.456');
    expect(s.deps.shopee.getProduct).toHaveBeenCalledWith(
      { appId: '18301234567', secret: 'S3CR3T' },
      { shopId: '123', itemId: '456' },
    );
    expect(s.deps.pageReader.read).not.toHaveBeenCalled();
    expect(out.needsManualData).toBe(false);
    expect(out.offer).toMatchObject({
      provider: 'SHOPEE', productRef: '123.456', title: 'Fone Bluetooth', priceCents: 4990, originalPriceCents: 9990,
      imageUrl: 'store://offers/1.jpg', affiliateUrl: 'https://shopee.com.br/fone-i.123.456', attributionVerified: false,
    });
    expect(out.offer.text).toContain('50% OFF');
    expect(JSON.stringify(out)).not.toContain('S3CR3T');
  });

  it('Shopee sem credencial: lê a página', async () => {
    const s = setup({ creds: {} });
    await run(s, 'https://shopee.com.br/fone-i.123.456');
    expect(s.deps.shopee.getProduct).not.toHaveBeenCalled();
    expect(s.deps.pageReader.read).toHaveBeenCalled();
  });

  it('Shopee API indisponível ou produto ausente → cai na página, oferta gravada', async () => {
    const s = setup({ limit: 5 });
    s.deps.shopee.getProduct.mockRejectedValueOnce(new AffiliateApiUnavailableError('SHOPEE'));
    s.deps.pageReader.read.mockResolvedValueOnce(null);
    const out = await run(s, 'https://shopee.com.br/fone-i.123.456');
    expect(out.needsManualData).toBe(true);
    expect(out.offer).toMatchObject({ title: null, priceCents: null, productRef: '123.456' });
    s.deps.shopee.getProduct.mockResolvedValueOnce(null);
    expect((await run(s, 'https://shopee.com.br/fone-i.123.456')).offer.title).toBe('Air Fryer 4L');
  });

  it('Amazon: página lida sem cookie; foto baixada e guardada', async () => {
    const s = setup();
    const out = await run(s, AMAZON);
    expect(s.deps.pageReader.read).toHaveBeenCalledWith({ url: new URL(AMAZON), mercadoLivreSessionToken: null });
    expect(s.deps.imageFetcher.fetch).toHaveBeenCalledWith(PAGE.imageUrl);
    expect(out.offer.imageUrl).toBe('store://offers/1.jpg');
  });

  it('foto não baixa ou store falha → oferta sem foto, needsManualData', async () => {
    const s = setup();
    s.deps.imageFetcher.fetch.mockResolvedValueOnce(null);
    expect(await run(s, AMAZON)).toMatchObject({ needsManualData: true, offer: { imageUrl: null } });
    s.deps.mediaStore.saveImage.mockRejectedValueOnce(new Error('disk'));
    expect((await run(s, AMAZON)).offer.imageUrl).toBeNull();
  });
});

describe('GenerateOfferUseCase — texto', () => {
  it('STANDARD: modelo fixo com cupom, sem IA', async () => {
    const s = setup();
    const out = await run(s, AMAZON, { coupon: ' PROMO10 ' });
    expect(s.ai.generate).not.toHaveBeenCalled();
    expect(out.aiFallback).toBe(false);
    expect(out.offer).toMatchObject({ coupon: 'PROMO10', audience: 'STANDARD' });
    expect(out.offer.text).toContain('🎟️ Cupom: PROMO10');
    expect(out.offer.text).toContain(AMAZON);
  });

  it('público PET: IA com purpose offer.text; link exato anexado se faltar', async () => {
    const s = setup();
    s.ai.generate.mockResolvedValueOnce({ text: 'Seu pet merece 🐶' });
    const out = await run(s, AMAZON, { audience: 'PET' });
    expect(s.ai.generate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, purpose: 'offer.text', maxOutputTokens: 400 }));
    expect(out.offer.text).toBe(`Seu pet merece 🐶\n\n🛒 ${AMAZON}`);
    expect(out).toMatchObject({ aiFallback: false, offer: { audience: 'PET' } });
  });

  it('erro AI_* → modelo fixo + aiFallback + aiErrorCode, oferta gravada', async () => {
    const s = setup();
    s.ai.generate.mockRejectedValueOnce(new AppError('AI_NOT_CONFIGURED', 'x', 409));
    const out = await run(s, AMAZON, { audience: 'PET' });
    expect(out).toMatchObject({ aiFallback: true, aiErrorCode: 'AI_NOT_CONFIGURED' });
    expect(out.offer.text).toContain('🔥 Air Fryer 4L');
    expect(s.offers.items).toHaveLength(1);
  });

  it('erro que não é de IA propaga', async () => {
    const s = setup();
    s.ai.generate.mockRejectedValueOnce(new Error('boom'));
    await expect(run(s, AMAZON, { audience: 'PET' })).rejects.toThrow('boom');
    expect(s.offers.items).toHaveLength(0);
  });
});
