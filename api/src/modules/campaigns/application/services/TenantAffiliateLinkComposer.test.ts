import { describe, expect, it, vi } from 'vitest';
import { TenantAffiliateLinkComposer } from './TenantAffiliateLinkComposer';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { OfferAffiliateCredential } from '../../domain/contracts/IAffiliateCredentialResolver';
import { AppError } from '../../../../shared/errors/AppError';

/** Só as 4 lojas já suportadas; as novas entram com as tasks de cada loja. */
type CurrentProvider = Exclude<AffiliateProvider, 'KABUM' | 'MAGALU' | 'ALIEXPRESS'>;
const CREDS: Record<CurrentProvider, OfferAffiliateCredential> = {
  AMAZON: { provider: 'AMAZON', publicIdentifier: 'meu-20', secret: null },
  SHOPEE: { provider: 'SHOPEE', publicIdentifier: '123456', secret: 's3cr3t' },
  MERCADO_LIVRE: { provider: 'MERCADO_LIVRE', publicIdentifier: 'minhaetq', secret: null, session: { cookies: { ssid: 'x' } } },
  SHEIN: { provider: 'SHEIN', publicIdentifier: '123456', secret: null, session: { cookies: { AT: 'AT-TOKEN', memberId: '123456' } } },
};
const SHARE = {
  affiliateUrl: 'https://onelink.shein.com/1/meu', title: 'Vestido Midi', priceCents: 2999, originalPriceCents: 5000,
  imageUrl: 'https://img.ltwebstatic.com/images3/v.jpg',
};
const KABUM_PRODUCT = { title: 'Mouse Gamer G203', priceCents: 16999, originalPriceCents: null, imageUrl: 'https://images.kabum.com.br/produtos/fotos/112948/mouse_g.jpg', available: true };
const SHEIN_URL = 'https://m.shein.com/br/Vestido-Midi-p-12345678-cat-1727.html?url_from=affiliate_koc_999999';

function setup(accepted = true) {
  const deps = {
    shopee: { getProduct: vi.fn(), generateShortLink: vi.fn().mockResolvedValue('https://s.shopee.com.br/meu') },
    mercadoLivre: {
      createAffiliateLinks: vi.fn().mockResolvedValue({ success: [{ originUrl: '', shortUrl: 'https://meli.la/meu', longUrl: '' }], errors: [] }),
      getActiveTag: vi.fn(),
      listAccountTags: vi.fn(),
    },
    pageReader: { read: vi.fn().mockResolvedValue({ title: 'Kit', imageUrl: null, priceCents: 1990, originalPriceCents: null, productRef: 'MLB998877' }) },
    shein: { getProductShare: vi.fn().mockResolvedValue(SHARE) },
    riskGate: { isAccepted: vi.fn(async (_t: string, _p: AffiliateProvider, _scope?: string) => accepted) },
    kabum: { getProduct: vi.fn().mockResolvedValue(KABUM_PRODUCT) },
  };
  const composer = new TenantAffiliateLinkComposer(deps);
  const compose = (provider: CurrentProvider, href: string, cred: OfferAffiliateCredential = CREDS[provider], mlTag?: string) =>
    composer.compose({ tenantId: 't1', provider, final: new URL(href), cred, ...(mlTag ? { mlTag } : {}) });
  return { deps, compose, composer };
}

describe('TenantAffiliateLinkComposer — ok com productRef', () => {
  it('Amazon: URL canônica + tag do tenant, ref = ASIN', async () => {
    const out = await setup().compose('AMAZON', 'https://www.amazon.com.br/Fone/dp/B0ABCDEFGH/ref=x?tag=outro-20');
    expect(out).toEqual({
      kind: 'ok', provider: 'AMAZON', productRef: 'B0ABCDEFGH',
      sourceUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH', affiliateUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=meu-20',
    });
  });

  it('Shopee: link pela API, ref = shopId.itemId', async () => {
    const s = setup();
    const out = await s.compose('SHOPEE', 'https://shopee.com.br/Fone-i.111.222?af_siteid=outro');
    expect(s.deps.shopee.generateShortLink).toHaveBeenCalledWith({ appId: '123456', secret: 's3cr3t' }, 'https://shopee.com.br/product/111/222');
    expect(out).toEqual({
      kind: 'ok', provider: 'SHOPEE', productRef: '111.222',
      sourceUrl: 'https://shopee.com.br/product/111/222', affiliateUrl: 'https://s.shopee.com.br/meu',
    });
  });

  it('Mercado Livre item: etiqueta principal, ref = MLB…', async () => {
    const s = setup();
    const out = await s.compose('MERCADO_LIVRE', 'https://produto.mercadolivre.com.br/MLB-123456-fone-_JM?matt_word=outro');
    expect(s.deps.mercadoLivre.createAffiliateLinks).toHaveBeenCalledWith({ ssid: 'x' }, ['https://produto.mercadolivre.com.br/MLB-123456'], 'minhaetq');
    expect(out).toEqual({
      kind: 'ok', provider: 'MERCADO_LIVRE', productRef: 'MLB123456',
      sourceUrl: 'https://produto.mercadolivre.com.br/MLB-123456', affiliateUrl: 'https://meli.la/meu',
    });
  });

  it('Mercado Livre vitrine social: ref achado na página e dados do produto', async () => {
    const s = setup();
    const out = await s.compose('MERCADO_LIVRE', 'https://www.mercadolivre.com.br/social/outro?matt_word=outro');
    expect(s.deps.pageReader.read).toHaveBeenCalledWith({ url: expect.any(URL) });
    expect(out).toEqual({
      kind: 'ok', provider: 'MERCADO_LIVRE', productRef: 'MLB998877',
      sourceUrl: 'https://www.mercadolivre.com.br/p/MLB998877', affiliateUrl: 'https://meli.la/meu',
      product: { title: 'Kit', priceCents: 1990, originalPriceCents: null, imageUrl: null },
    });
  });

  it('Mercado Livre com mlTag: a etiqueta informada vai ao createAffiliateLinks', async () => {
    const s = setup();
    await s.compose('MERCADO_LIVRE', 'https://www.mercadolivre.com.br/fone/p/MLB777', CREDS.MERCADO_LIVRE, 'segunda');
    expect(s.deps.mercadoLivre.createAffiliateLinks).toHaveBeenCalledWith({ ssid: 'x' }, ['https://www.mercadolivre.com.br/p/MLB777'], 'segunda');
  });

  it('Shein: shareLink + dados, ref = goodsId', async () => {
    const s = setup();
    const out = await s.compose('SHEIN', SHEIN_URL);
    expect(s.deps.shein.getProductShare).toHaveBeenCalledWith({ token: 'AT-TOKEN', memberId: '123456' }, '12345678');
    expect(out).toEqual({
      kind: 'ok', provider: 'SHEIN', productRef: '12345678',
      sourceUrl: 'https://br.shein.com/product-p-12345678.html', affiliateUrl: SHARE.affiliateUrl,
      product: { title: 'Vestido Midi', priceCents: 2999, originalPriceCents: 5000, imageUrl: SHARE.imageUrl },
    });
  });
});

describe('TenantAffiliateLinkComposer — sem link', () => {
  it('sem produto reconhecível: unsupported, sem chamar a loja', async () => {
    const s = setup();
    s.deps.pageReader.read.mockResolvedValueOnce(null);
    expect(await s.compose('AMAZON', 'https://www.amazon.com.br/s?k=fone')).toEqual({ kind: 'unsupported' });
    expect(await s.compose('SHOPEE', 'https://shopee.com.br/search?keyword=fone')).toEqual({ kind: 'unsupported' });
    expect(await s.compose('MERCADO_LIVRE', 'https://www.mercadolivre.com.br/social/outro')).toEqual({ kind: 'unsupported' });
    expect(await s.compose('SHEIN', 'https://br.shein.com/')).toEqual({ kind: 'unsupported' });
    expect(s.deps.shopee.generateShortLink).not.toHaveBeenCalled();
    expect(s.deps.mercadoLivre.createAffiliateLinks).not.toHaveBeenCalled();
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('credential_missing: Shopee sem secret, ML sem cookies, Shein sem AT', async () => {
    const s = setup();
    expect(await s.compose('SHOPEE', 'https://shopee.com.br/product/1/2', { ...CREDS.SHOPEE, secret: null }))
      .toEqual({ kind: 'credential_missing', provider: 'SHOPEE' });
    expect(await s.compose('MERCADO_LIVRE', 'https://www.mercadolivre.com.br/fone/p/MLB777', { ...CREDS.MERCADO_LIVRE, session: undefined }))
      .toEqual({ kind: 'credential_missing', provider: 'MERCADO_LIVRE' });
    expect(await s.compose('SHEIN', SHEIN_URL, { ...CREDS.SHEIN, session: { cookies: { memberId: '123456' } } }))
      .toEqual({ kind: 'credential_missing', provider: 'SHEIN' });
    expect(s.deps.riskGate.isAccepted).not.toHaveBeenCalled();
    expect(s.deps.shopee.generateShortLink).not.toHaveBeenCalled();
    expect(s.deps.mercadoLivre.createAffiliateLinks).not.toHaveBeenCalled();
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('Shein sem aceite do aviso: risk_not_accepted sem chamar a Shein', async () => {
    const s = setup(false);
    expect(await s.compose('SHEIN', SHEIN_URL)).toEqual({ kind: 'risk_not_accepted', provider: 'SHEIN' });
    expect(s.deps.riskGate.isAccepted).toHaveBeenCalledWith('t1', 'SHEIN', 'AFFILIATE_LINK');
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('riskScope OFFER_HUNTER: cobra só o aceite do caçador', async () => {
    const s = setup();
    s.deps.riskGate.isAccepted.mockImplementation(async (_t: string, _p: AffiliateProvider, scope?: string) => scope === 'OFFER_HUNTER');
    const out = await s.composer.compose({ tenantId: 't1', provider: 'SHEIN', final: new URL(SHEIN_URL), cred: CREDS.SHEIN, riskScope: 'OFFER_HUNTER' });
    expect(out).toMatchObject({ kind: 'ok', provider: 'SHEIN', affiliateUrl: SHARE.affiliateUrl });
    expect(s.deps.riskGate.isAccepted).toHaveBeenCalledTimes(1);
    expect(s.deps.riskGate.isAccepted).toHaveBeenCalledWith('t1', 'SHEIN', 'OFFER_HUNTER');
  });

  it('riskScope OFFER_HUNTER sem aceite do caçador (só o do link): risk_not_accepted sem chamar a Shein', async () => {
    const s = setup();
    s.deps.riskGate.isAccepted.mockImplementation(async (_t: string, _p: AffiliateProvider, scope?: string) => scope === 'AFFILIATE_LINK');
    const out = await s.composer.compose({ tenantId: 't1', provider: 'SHEIN', final: new URL(SHEIN_URL), cred: CREDS.SHEIN, riskScope: 'OFFER_HUNTER' });
    expect(out).toEqual({ kind: 'risk_not_accepted', provider: 'SHEIN' });
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('Shein com share nulo ou fora da allowlist: failed SHEIN_LINK_NOT_CREATED', async () => {
    const s = setup();
    s.deps.shein.getProductShare.mockResolvedValueOnce(null);
    expect(await s.compose('SHEIN', SHEIN_URL)).toEqual({ kind: 'failed', provider: 'SHEIN', code: 'SHEIN_LINK_NOT_CREATED' });
    for (const bad of ['https://evil.example.com/x', 'http://onelink.shein.com/1/x']) {
      s.deps.shein.getProductShare.mockResolvedValueOnce({ ...SHARE, affiliateUrl: bad });
      expect(await s.compose('SHEIN', SHEIN_URL)).toEqual({ kind: 'failed', provider: 'SHEIN', code: 'SHEIN_LINK_NOT_CREATED' });
    }
  });

  it('ML sem link: failed com o código por item da ML', async () => {
    const s = setup();
    s.deps.mercadoLivre.createAffiliateLinks.mockResolvedValueOnce({ success: [], errors: [{ originUrl: '', errorCode: 1004, message: 'closed' }] });
    expect(await s.compose('MERCADO_LIVRE', 'https://www.mercadolivre.com.br/fone/p/MLB777')).toEqual({ kind: 'failed', provider: 'MERCADO_LIVRE', code: 'ML_1004' });
  });

  it('AppError da loja sobe (quem chama decide pausar ou avisar)', async () => {
    const s = setup();
    const rejected = new AppError('AFFILIATE_CREDENTIAL_REJECTED', 'no', 401);
    s.deps.shopee.generateShortLink.mockRejectedValueOnce(rejected);
    await expect(s.compose('SHOPEE', 'https://shopee.com.br/product/1/2')).rejects.toBe(rejected);
    s.deps.shein.getProductShare.mockRejectedValueOnce(new AppError('AFFILIATE_API_UNAVAILABLE', 'x', 503));
    await expect(s.compose('SHEIN', SHEIN_URL)).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });
});

describe('TenantAffiliateLinkComposer — Kabum', () => {
  const KCRED: OfferAffiliateCredential = { provider: 'KABUM', publicIdentifier: '1234567', secret: null };
  const LINK = 'https://www.awin1.com/cread.php?awinmid=17729&awinaffid=1234567&ued=https%3A%2F%2Fwww.kabum.com.br%2Fproduto%2F112948';
  const kabum = (s: ReturnType<typeof setup>, href: string, cred: OfferAffiliateCredential = KCRED) =>
    s.composer.compose({ tenantId: 't1', provider: 'KABUM', final: new URL(href), cred });

  it('URL de produto: link Awin exato, ref = id, produto do catálogo', async () => {
    const s = setup();
    const out = await kabum(s, 'https://www.kabum.com.br/produto/112948/mouse-gamer?utm_source=x');
    expect(s.deps.kabum.getProduct).toHaveBeenCalledWith('112948');
    expect(out).toEqual({
      kind: 'ok', provider: 'KABUM', productRef: '112948', sourceUrl: 'https://www.kabum.com.br/produto/112948', affiliateUrl: LINK,
      product: { title: KABUM_PRODUCT.title, priceCents: 16999, originalPriceCents: null, imageUrl: KABUM_PRODUCT.imageUrl },
    });
  });

  it('link Awin de outro afiliado: recriado com o Publisher ID do tenant', async () => {
    const other = `https://www.awin1.com/cread.php?awinmid=17729&awinaffid=999999&clickref=x&ued=${encodeURIComponent('https://www.kabum.com.br/produto/112948/slug?x=1')}`;
    const out = await kabum(setup(), other);
    expect(out).toMatchObject({ kind: 'ok', affiliateUrl: LINK });
  });

  it('sem Publisher ID: credential_missing sem chamar o catálogo', async () => {
    const s = setup();
    expect(await kabum(s, 'https://www.kabum.com.br/produto/112948', { ...KCRED, publicIdentifier: '' })).toEqual({ kind: 'credential_missing', provider: 'KABUM' });
    expect(s.deps.kabum.getProduct).not.toHaveBeenCalled();
  });

  it('sem produto reconhecível: unsupported, sem rede', async () => {
    const s = setup();
    expect(await kabum(s, 'https://www.kabum.com.br/hardware')).toEqual({ kind: 'unsupported' });
    expect(s.deps.kabum.getProduct).not.toHaveBeenCalled();
  });

  it('produto indisponível (null) → OFFER_PRODUCT_NOT_FOUND; catálogo fora → AFFILIATE_API_UNAVAILABLE sobe', async () => {
    const s = setup();
    s.deps.kabum.getProduct.mockResolvedValueOnce(null);
    await expect(kabum(s, 'https://www.kabum.com.br/produto/112948')).rejects.toMatchObject({ code: 'OFFER_PRODUCT_NOT_FOUND', meta: { provider: 'KABUM' } });
    s.deps.kabum.getProduct.mockRejectedValueOnce(new AppError('AFFILIATE_API_UNAVAILABLE', 'x', 503));
    await expect(kabum(s, 'https://www.kabum.com.br/produto/112948')).rejects.toMatchObject({ code: 'AFFILIATE_API_UNAVAILABLE' });
  });

  it('Magalu e AliExpress seguem não suportados (provisório)', async () => {
    const s = setup();
    for (const provider of ['MAGALU', 'ALIEXPRESS'] as const) {
      await expect(s.composer.compose({ tenantId: 't1', provider, final: new URL('https://www.magazineluiza.com.br/p/abc/'), cred: KCRED }))
        .rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
    }
  });
});
