import { describe, it, expect, vi } from 'vitest';
import { GenerateOfferUseCase, type GenerateOfferDeps } from './GenerateOfferUseCase';
import { FakeEntitlementReader, InMemoryOfferRepository, makeOffer, NOW, TENANT, USER } from './offerTestFakes';
import { OfferTextComposer } from '../services/OfferTextComposer';
import { TenantAffiliateLinkComposer } from '../services/TenantAffiliateLinkComposer';
import { ResolveAffiliateProductUseCase } from './ResolveAffiliateProductUseCase';
import { ResolveProductDataUseCase } from './ResolveProductDataUseCase';
import type { IShopeeAffiliateClient, ShopeeProduct } from '../../domain/contracts/IShopeeAffiliateClient';
import type { OfferAffiliateCredential } from '../../domain/contracts/IAffiliateCredentialResolver';
import type { ProductPageData } from '../../domain/services/parseProductPage';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import { AppError } from '../../../../shared/errors/AppError';
import { OfferUrlUnsupportedError, AffiliateApiUnavailableError, OfferLinkRebuildFailedError } from '../../../../shared/errors/internal/OfferErrors';

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
  MERCADO_LIVRE: { provider: 'MERCADO_LIVRE', publicIdentifier: 'minhaetq', secret: null, session: { cookies: { ssid: 'SSID-TOKEN' } } },
  SHEIN: { provider: 'SHEIN', publicIdentifier: '1234567890', secret: null, session: { cookies: { AT: 'AT-TOKEN', memberId: '1234567890' } } },
};

function setup(opts: { limit?: number | null; creds?: Partial<Record<AffiliateProvider, OfferAffiliateCredential>> } = {}) {
  const offers = new InMemoryOfferRepository();
  const shopee = {
    getProduct: vi.fn().mockResolvedValue(SHOPEE_PRODUCT),
    generateShortLink: vi.fn().mockResolvedValue('https://s.shopee.com.br/dotenant'),
  } satisfies IShopeeAffiliateClient;
  const ai = { generate: vi.fn().mockResolvedValue({ text: 'Texto da IA 💜\nhttps://amzn.to/abc' }) };
  const entitlements = new FakeEntitlementReader(opts.limit != null ? { offer_generations_per_day: opts.limit } : {});
  const pageReader = { read: vi.fn().mockResolvedValue(PAGE) };
  const imageFetcher = { fetch: vi.fn().mockResolvedValue({ buffer: Buffer.from('img'), mimeType: 'image/jpeg' }) };
  const mediaStore = { saveImage: vi.fn().mockResolvedValue('store://offers/1.jpg'), consumeUploadedImage: vi.fn(), removeImage: vi.fn() };
  // Deps do Resolve: o gerador recebe a instância pronta, como no container
  const resolveFakes = {
    expander: { expand: vi.fn(async (u: URL) => u) },
    credentials: {
      resolveState: vi.fn(async (_t: string, p: AffiliateProvider) => {
        const cred = (opts.creds ?? CREDS)[p];
        return cred ? { state: 'ok' as const, cred } : { state: 'missing' as const };
      }),
    },
    mercadoLivre: { createAffiliateLinks: vi.fn().mockResolvedValue({ success: [{ originUrl: '', shortUrl: 'https://meli.la/gerado', longUrl: '' }], errors: [] }), getActiveTag: vi.fn().mockResolvedValue(null), listAccountTags: vi.fn() },
    shein: { getProductShare: vi.fn().mockResolvedValue(null) },
    riskGate: { isAccepted: vi.fn().mockResolvedValue(true) },
  };
  const { expander, credentials, mercadoLivre, shein, riskGate } = resolveFakes;
  const affiliateProducts = new ResolveAffiliateProductUseCase({
    expander, credentials, shein, entitlements, riskGate,
    composer: new TenantAffiliateLinkComposer({ shopee, mercadoLivre, pageReader, shein, riskGate }),
    products: new ResolveProductDataUseCase({ shopee, pageReader, imageFetcher, mediaStore }),
  });
  const deps = {
    offers,
    entitlements,
    affiliateProducts,
    shopee,
    pageReader,
    imageFetcher,
    mediaStore,
    texts: new OfferTextComposer(ai),
    now: () => NOW,
  } satisfies GenerateOfferDeps;
  return { deps: { ...deps, ...resolveFakes }, offers, ai, uc: new GenerateOfferUseCase(deps) };
}

const AMAZON = 'https://www.amazon.com.br/Fone/dp/B0ABCDEFGH/ref=sr_1?tag=loja-20';
// Amazon é sempre reescrita na forma canônica com a tag do tenant (D2)
const AMAZON_TENANT = 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=loja-20';
const run = (s: ReturnType<typeof setup>, url: string, extra: { coupon?: string | null; audience?: 'STANDARD' | 'PET'; scheduledAt?: string | null } = {}) =>
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

describe('GenerateOfferUseCase — link de afiliado sempre do tenant', () => {
  it('Amazon curto: reescrita com a tag do tenant; sourceUrl = colado', async () => {
    const s = setup();
    s.deps.expander.expand.mockResolvedValueOnce(new URL('https://www.amazon.com.br/dp/B0ZZZZZZZZ?tag=LOJA-20&ref=x'));
    const { offer } = await run(s, 'https://amzn.to/abc');
    expect(offer).toMatchObject({
      affiliateUrl: 'https://www.amazon.com.br/dp/B0ZZZZZZZZ?tag=loja-20', sourceUrl: 'https://amzn.to/abc', productRef: 'B0ZZZZZZZZ', attributionVerified: true,
    });
    expect(s.deps.shopee.generateShortLink).not.toHaveBeenCalled();
  });

  it('Amazon com tag de outra conta → recriado com a tag do tenant, sem a alheia', async () => {
    const s = setup();
    const out = await run(s, 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=outro-20');
    expect(out.offer).toMatchObject({ affiliateUrl: AMAZON_TENANT, attributionVerified: true });
    expect(out.linkRebuilt).toBe(true);
    expect(out.offer.text).not.toContain('outro-20');
  });

  it('Amazon sem tag e sem credencial → AFFILIATE_CREDENTIAL_REQUIRED, nada gravado', async () => {
    const s = setup({ creds: {} });
    await expect(run(s, 'https://www.amazon.com.br/dp/B0ABCDEFGH')).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REQUIRED', statusCode: 422 });
    expect(s.offers.items).toHaveLength(0);
  });

  it('sem credencial do marketplace: bloqueia (D1), sem ler a página', async () => {
    const s = setup({ creds: {} });
    await expect(run(s, AMAZON)).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REQUIRED', meta: { provider: 'AMAZON' } });
    expect(s.deps.pageReader.read).not.toHaveBeenCalled();
  });

  it('ML: link longo do tenant → recriado (D2); página lida com cookie da sessão', async () => {
    const s = setup();
    const url = 'https://produto.mercadolivre.com.br/MLB-123456-fone?matt_word=minhaetq&matt_tool=1';
    const out = await run(s, url);
    expect(out.offer).toMatchObject({ provider: 'MERCADO_LIVRE', productRef: 'MLB123456', attributionVerified: true, affiliateUrl: 'https://meli.la/gerado' });
    expect(s.deps.pageReader.read).toHaveBeenCalledWith({ url: new URL(url), mercadoLivreCookies: { ssid: 'SSID-TOKEN' } });
    expect(JSON.stringify(out)).not.toContain('SSID-TOKEN');
  });

  it('ML: matt_word de outra etiqueta ou sem matt_word → recriado com a etiqueta do tenant', async () => {
    const s = setup();
    for (const url of ['https://produto.mercadolivre.com.br/MLB-1-x?matt_word=outra', 'https://produto.mercadolivre.com.br/MLB-1-x']) {
      expect((await run(s, url)).offer).toMatchObject({ affiliateUrl: 'https://meli.la/gerado', attributionVerified: true });
    }
    expect(s.deps.mercadoLivre.createAffiliateLinks).toHaveBeenCalledWith({ ssid: 'SSID-TOKEN' }, ['https://produto.mercadolivre.com.br/MLB-1'], 'minhaetq');
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
    expect(out).toMatchObject({ needsManualData: false, linkRebuilt: false });
  });

  it('página social sem matt_word: etiqueta do path de outro → recriado com a do tenant', async () => {
    const s = setup();
    s.deps.expander.expand.mockResolvedValueOnce(new URL('https://www.mercadolivre.com.br/social/outra'));
    s.deps.pageReader.read.mockResolvedValueOnce({ ...PAGE, productRef: 'MLB999' });
    const out = await run(s, 'https://meli.la/xyz');
    expect(out.offer).toMatchObject({ affiliateUrl: 'https://meli.la/gerado', productRef: 'MLB999', sourceUrl: 'https://meli.la/xyz' });
    expect(out.linkRebuilt).toBe(true);
  });

  it('falha ao recriar → erro do Resolve propaga, nada gravado nem contado', async () => {
    const s = setup({ limit: 5 });
    s.deps.mercadoLivre.createAffiliateLinks.mockResolvedValueOnce({ success: [], errors: [{ originUrl: '', errorCode: 100, message: 'URL Invalid' }] });
    await expect(run(s, 'https://produto.mercadolivre.com.br/MLB-1-x?matt_word=outra')).rejects.toMatchObject({ code: 'OFFER_LINK_REBUILD_FAILED' });
    expect(s.offers.items).toHaveLength(0);
    expect(s.deps.mediaStore.saveImage).not.toHaveBeenCalled();
  });

  it('linkRebuilt vem do Resolve, não dos campos gravados (TLINK-12)', async () => {
    const s = setup();
    const resolved = {
      provider: 'AMAZON' as const, sourceUrl: AMAZON, affiliateUrl: AMAZON_TENANT, attributionVerified: true,
      product: { productRef: 'B0ABCDEFGH', title: 'Fone', priceCents: 100, originalPriceCents: null, imageSourceUrl: null },
    };
    const spy = vi.spyOn(s.deps.affiliateProducts, 'execute');
    spy.mockResolvedValueOnce({ ...resolved, linkRebuilt: false });
    expect((await run(s, AMAZON)).linkRebuilt).toBe(false);
    spy.mockResolvedValueOnce({ ...resolved, linkRebuilt: true });
    expect((await run(s, AMAZON)).linkRebuilt).toBe(true);
    spy.mockRejectedValueOnce(new OfferLinkRebuildFailedError('AMAZON', 'X'));
    await expect(run(s, AMAZON)).rejects.toMatchObject({ code: 'OFFER_LINK_REBUILD_FAILED' });
    expect(s.offers.items).toHaveLength(2);
  });
});

describe('GenerateOfferUseCase — dados do produto', () => {
  it('Shopee com secret: Open API para os dados e link recriado pela conta do tenant', async () => {
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
      imageUrl: 'store://offers/1.jpg', affiliateUrl: 'https://s.shopee.com.br/dotenant', attributionVerified: true,
    });
    expect(out.offer.text).toContain('50% OFF');
    expect(JSON.stringify(out)).not.toContain('S3CR3T');
  });

  it('Shopee sem credencial: AFFILIATE_CREDENTIAL_REQUIRED, sem API nem página', async () => {
    const s = setup({ creds: {} });
    await expect(run(s, 'https://shopee.com.br/fone-i.123.456')).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REQUIRED' });
    expect(s.deps.shopee.getProduct).not.toHaveBeenCalled();
    expect(s.deps.pageReader.read).not.toHaveBeenCalled();
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
    expect(s.deps.pageReader.read).toHaveBeenCalledWith({ url: new URL(AMAZON), mercadoLivreCookies: null });
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
    expect(out.offer.text).toContain(AMAZON_TENANT);
  });

  it('público PET: IA com purpose offer.text; link exato anexado se faltar', async () => {
    const s = setup();
    s.ai.generate.mockResolvedValueOnce({ text: 'Seu pet merece 🐶' });
    const out = await run(s, AMAZON, { audience: 'PET' });
    expect(s.ai.generate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, purpose: 'offer.text', maxOutputTokens: 400 }));
    expect(out.offer.text).toBe(`Seu pet merece 🐶\n\n🛒 ${AMAZON_TENANT}`);
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

describe('GenerateOfferUseCase — início agendado', () => {
  it('grava o horário agendado na oferta', async () => {
    const s = setup();
    const at = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = await run(s, AMAZON, { scheduledAt: at });
    expect(out.offer.scheduledAt).toBe(at);
  });

  it('horário passado → OFFER_INVALID_INPUT (scheduledAt) sem rede', async () => {
    const s = setup();
    await expect(run(s, AMAZON, { scheduledAt: new Date(NOW.getTime() - 1000).toISOString() }))
      .rejects.toMatchObject({ code: 'OFFER_INVALID_INPUT', meta: { field: 'scheduledAt' } });
    expect(s.deps.expander.expand).not.toHaveBeenCalled();
  });
});

describe('GenerateOfferUseCase — Shein (gate e aceite no Resolve)', () => {
  const SHEIN = 'https://br.shein.com/Vestido-p-12345678.html?url_from=affiliate_koc_1234567890';

  it('chave do plano ausente: PLAN_FEATURE_UNAVAILABLE sem gravar nem chamar a Shein', async () => {
    const s = setup();
    await expect(run(s, SHEIN)).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
    expect(s.offers.items).toHaveLength(0);
  });

  it('com plano e sem aceite: MARKETPLACE_RISK_NOT_ACCEPTED sem chamar a Shein', async () => {
    const s = setup();
    s.deps.entitlements.values.marketplace_shein_enabled = true;
    s.deps.riskGate.isAccepted.mockResolvedValueOnce(false);
    await expect(run(s, SHEIN)).rejects.toMatchObject({ code: 'MARKETPLACE_RISK_NOT_ACCEPTED' });
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });
});
