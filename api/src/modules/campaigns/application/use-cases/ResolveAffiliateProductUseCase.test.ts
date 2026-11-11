import { describe, it, expect, vi } from 'vitest';
import { ResolveAffiliateProductUseCase } from './ResolveAffiliateProductUseCase';
import { ResolveProductDataUseCase } from './ResolveProductDataUseCase';
import { TENANT } from './offerTestFakes';
import type { OfferAffiliateCredential } from '../../domain/contracts/IAffiliateCredentialResolver';
import type { ProductPageData } from '../../domain/services/parseProductPage';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { AffiliateCredentialState } from '../../domain/contracts/IAffiliateCredentialGateway';
import { AppError } from '../../../../shared/errors/AppError';

const PAGE: ProductPageData = {
  title: 'Air Fryer 4L',
  imageUrl: 'https://http2.mlstatic.com/D_NQ_NP_1.jpg',
  priceCents: 29990,
  originalPriceCents: 39990,
  productRef: null,
};

const CREDS: Partial<Record<AffiliateProvider, OfferAffiliateCredential>> = {
  AMAZON: { provider: 'AMAZON', publicIdentifier: 'loja-20', secret: null },
  MERCADO_LIVRE: { provider: 'MERCADO_LIVRE', publicIdentifier: 'minhaetq', secret: null, session: { cookies: { ssid: 'SSID-TOKEN' } } },
};

const SHEIN_CRED: OfferAffiliateCredential = {
  provider: 'SHEIN', publicIdentifier: '123456', secret: null, session: { cookies: { AT: 'AT-TOKEN', memberId: '123456' } },
};
const SHARE = {
  affiliateUrl: 'https://onelink.shein.com/1/gerado', title: 'Vestido Midi', priceCents: 2999, originalPriceCents: 5000,
  imageUrl: 'https://img.ltwebstatic.com/images3/v.jpg',
};

function setup(
  creds: Partial<Record<AffiliateProvider, OfferAffiliateCredential>> = CREDS,
  opts: { ent?: Record<string, unknown>; accepted?: boolean; rejected?: AffiliateProvider[] } = {},
) {
  const ent: Record<string, unknown> = opts.ent ?? { marketplace_shein_enabled: true };
  const imageFetcher = { fetch: vi.fn() };
  const mediaStore = { saveImage: vi.fn(), consumeUploadedImage: vi.fn(), removeImage: vi.fn() };
  const pageReader = { read: vi.fn().mockResolvedValue(PAGE) };
  const deps = {
    expander: { expand: vi.fn(async (u: URL) => u) },
    credentials: {
      execute: vi.fn(async (_t: string, p: AffiliateProvider) => creds[p] ?? null),
      resolveState: vi.fn<(t: string, p: AffiliateProvider) => Promise<AffiliateCredentialState>>(async (_t, p) => {
        if (opts.rejected?.includes(p)) return { state: 'rejected', since: new Date(0), code: 'AFFILIATE_CREDENTIAL_REJECTED' };
        return creds[p] ? { state: 'ok', cred: creds[p]! } : { state: 'missing' };
      }),
      // Só para provar que o resolver nunca pausa a loja
      markRejected: vi.fn().mockResolvedValue(undefined),
    },
    mercadoLivre: { createAffiliateLinks: vi.fn().mockResolvedValue({ success: [], errors: [] }), getActiveTag: vi.fn(), listAccountTags: vi.fn() },
    products: new ResolveProductDataUseCase({
      shopee: { getProduct: vi.fn(), generateShortLink: vi.fn() }, pageReader, imageFetcher, mediaStore,
    }),
    shein: { getProductShare: vi.fn().mockResolvedValue(SHARE) },
    entitlements: {
      getNumber: vi.fn(async () => null),
      getBoolean: vi.fn(async (_t: string, k: string) => (typeof ent[k] === 'boolean' ? (ent[k] as boolean) : null)),
    },
    riskGate: { isAccepted: vi.fn(async () => opts.accepted ?? true) },
  };
  vi.spyOn(deps.products, 'resolve');
  return { deps, pageReader, imageFetcher, mediaStore, uc: new ResolveAffiliateProductUseCase(deps) };
}

const AMAZON = 'https://www.amazon.com.br/Fone/dp/B0ABCDEFGH/ref=sr_1?tag=loja-20';
const ML_PLAIN = 'https://produto.mercadolivre.com.br/MLB-123456-fone';

describe('ResolveAffiliateProductUseCase', () => {
  it('Amazon do tenant: link colado, verificado, dados da página e foto só como URL externa', async () => {
    const s = setup();
    const out = await s.uc.execute(TENANT, `  ${AMAZON}  `);
    expect(out).toEqual({
      provider: 'AMAZON',
      sourceUrl: AMAZON,
      affiliateUrl: AMAZON,
      attributionVerified: true,
      product: {
        productRef: 'B0ABCDEFGH', title: 'Air Fryer 4L', priceCents: 29990, originalPriceCents: 39990,
        imageSourceUrl: 'https://http2.mlstatic.com/D_NQ_NP_1.jpg',
      },
    });
    expect(s.imageFetcher.fetch).not.toHaveBeenCalled();
    expect(s.mediaStore.saveImage).not.toHaveBeenCalled();
  });

  it('texto que não é URL ou domínio fora da allowlist → OFFER_URL_UNSUPPORTED sem rede', async () => {
    const s = setup();
    await expect(s.uc.execute(TENANT, 'não é url')).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
    await expect(s.uc.execute(TENANT, 'https://exemplo.com/produto')).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
    expect(s.deps.expander.expand).not.toHaveBeenCalled();
  });

  it('produto não reconhecido na URL final → OFFER_URL_UNSUPPORTED', async () => {
    const s = setup();
    await expect(s.uc.execute(TENANT, 'https://amazon.com.br/s?k=fone&tag=loja-20')).rejects.toMatchObject({
      code: 'OFFER_URL_UNSUPPORTED',
    });
    expect(s.pageReader.read).not.toHaveBeenCalled();
  });

  it('tag de outra conta → OFFER_LINK_NOT_OWNED, sem ler a página', async () => {
    const s = setup();
    await expect(s.uc.execute(TENANT, 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=outro-20')).rejects.toMatchObject({
      code: 'OFFER_LINK_NOT_OWNED',
    });
    expect(s.pageReader.read).not.toHaveBeenCalled();
  });

  it('sem credencial: não bloqueia, attributionVerified=false', async () => {
    const s = setup({});
    const out = await s.uc.execute(TENANT, AMAZON);
    expect(out).toMatchObject({ affiliateUrl: AMAZON, attributionVerified: false });
  });

  it('ML sem afiliação com sessão: gera o link e marca verificado', async () => {
    const s = setup();
    s.deps.mercadoLivre.createAffiliateLinks.mockResolvedValueOnce({ success: [{ shortUrl: 'https://meli.la/gerado' }], errors: [] });
    const out = await s.uc.execute(TENANT, ML_PLAIN);
    expect(out).toMatchObject({ provider: 'MERCADO_LIVRE', sourceUrl: ML_PLAIN, affiliateUrl: 'https://meli.la/gerado', attributionVerified: true });
    expect(s.deps.mercadoLivre.createAffiliateLinks).toHaveBeenCalledWith({ ssid: 'SSID-TOKEN' }, [ML_PLAIN], 'minhaetq');
  });

  it('ML sem afiliação: geração vazia ou AppError → OFFER_LINK_NOT_AFFILIATE; sem sessão nem tenta', async () => {
    const s = setup();
    await expect(s.uc.execute(TENANT, ML_PLAIN)).rejects.toMatchObject({ code: 'OFFER_LINK_NOT_AFFILIATE' });
    s.deps.mercadoLivre.createAffiliateLinks.mockRejectedValueOnce(new AppError('ML_DOWN', 'down', 503));
    await expect(s.uc.execute(TENANT, ML_PLAIN)).rejects.toMatchObject({ code: 'OFFER_LINK_NOT_AFFILIATE' });

    const noSession = setup({ MERCADO_LIVRE: { provider: 'MERCADO_LIVRE', publicIdentifier: 'minhaetq', secret: null } });
    await expect(noSession.uc.execute(TENANT, ML_PLAIN)).rejects.toMatchObject({ code: 'OFFER_LINK_NOT_AFFILIATE' });
    expect(noSession.deps.mercadoLivre.createAffiliateLinks).not.toHaveBeenCalled();
  });

  it('ML: erro que não é AppError na geração propaga', async () => {
    const s = setup();
    s.deps.mercadoLivre.createAffiliateLinks.mockRejectedValueOnce(new TypeError('bug'));
    await expect(s.uc.execute(TENANT, ML_PLAIN)).rejects.toBeInstanceOf(TypeError);
  });

  it('ML vitrine social (sem ref na URL): aceita e usa o productRef da página', async () => {
    const s = setup();
    s.deps.expander.expand.mockResolvedValueOnce(
      new URL('https://www.mercadolivre.com.br/social/minhaetq?matt_word=minhaetq&matt_tool=63844234'),
    );
    s.pageReader.read.mockResolvedValueOnce({ ...PAGE, productRef: 'MLB999' });
    const out = await s.uc.execute(TENANT, 'https://meli.la/1Hb6zu6');
    expect(out).toMatchObject({
      provider: 'MERCADO_LIVRE', affiliateUrl: 'https://meli.la/1Hb6zu6', attributionVerified: true,
      product: { productRef: 'MLB999' },
    });
    expect(s.pageReader.read).toHaveBeenCalledWith(expect.objectContaining({ mercadoLivreCookies: { ssid: 'SSID-TOKEN' } }));
  });

  it('ML meli.la → social com apelido do perfil ≠ etiqueta do tenant: verificado pelo matt_word', async () => {
    const s = setup();
    s.deps.expander.expand.mockResolvedValueOnce(
      new URL('https://www.mercadolivre.com.br/social/apelidodoperfil?matt_word=minhaetq&matt_tool=63844234'),
    );
    s.pageReader.read.mockResolvedValueOnce({ ...PAGE, productRef: 'MLB999' });
    const out = await s.uc.execute(TENANT, 'https://meli.la/2Xy9abc');
    expect(out).toMatchObject({
      provider: 'MERCADO_LIVRE', affiliateUrl: 'https://meli.la/2Xy9abc', attributionVerified: true,
      product: { productRef: 'MLB999' },
    });
    expect(s.deps.mercadoLivre.createAffiliateLinks).not.toHaveBeenCalled();
  });

  it('ML, Shopee e Amazon nunca passam pelo gate de plano nem de aceite', async () => {
    const s = setup(CREDS, { ent: {}, accepted: false });
    await s.uc.execute(TENANT, AMAZON);
    await s.uc.execute(TENANT, 'https://shopee.com.br/Fone-i.111.222');
    s.deps.mercadoLivre.createAffiliateLinks.mockResolvedValueOnce({ success: [{ shortUrl: 'https://meli.la/g' }], errors: [] });
    await s.uc.execute(TENANT, ML_PLAIN);
    expect(s.deps.entitlements.getBoolean).not.toHaveBeenCalled();
    expect(s.deps.riskGate.isAccepted).not.toHaveBeenCalled();
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('outros marketplaces leem a credencial por execute, mesmo com recusa registrada', async () => {
    const s = setup(CREDS, { rejected: ['AMAZON'] });
    await expect(s.uc.execute(TENANT, AMAZON)).resolves.toMatchObject({ attributionVerified: true });
    expect(s.deps.credentials.resolveState).not.toHaveBeenCalled();
  });
});

describe('ResolveAffiliateProductUseCase — Shein', () => {
  const PRODUCT = 'https://br.shein.com/Vestido-Midi-p-12345678.html';
  const MINE = `${PRODUCT}?url_from=affiliate_koc_123456`;
  const OTHER = `${PRODUCT}?url_from=affiliate_koc_999999`;
  const WITH = { SHEIN: SHEIN_CRED };
  const EMPTY = { productRef: '12345678', title: null, priceCents: null, originalPriceCents: null, imageSourceUrl: null };

  it('chave do plano ausente ou false bloqueia (PLAN_FEATURE_UNAVAILABLE) antes de ler a credencial', async () => {
    for (const ent of [{}, { marketplace_shein_enabled: false }]) {
      const s = setup(WITH, { ent });
      await expect(s.uc.execute(TENANT, MINE)).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', statusCode: 403 });
      expect(s.deps.credentials.execute).not.toHaveBeenCalled();
      expect(s.deps.credentials.resolveState).not.toHaveBeenCalled();
      expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
    }
  });

  it('sem plano + link curto `onelink` colado: bloqueia sem expandir (nenhuma rede)', async () => {
    const s = setup(WITH, { ent: {} });
    await expect(s.uc.execute(TENANT, 'https://onelink.shein.com/1/abc')).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
    expect(s.deps.expander.expand).not.toHaveBeenCalled();
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('link de outro marketplace que redireciona para a Shein: gate de plano depois do expand', async () => {
    const s = setup(WITH, { ent: {} });
    s.deps.expander.expand.mockResolvedValueOnce(new URL(MINE));
    await expect(s.uc.execute(TENANT, 'https://amzn.to/abc')).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
    expect(s.deps.expander.expand).toHaveBeenCalledTimes(1);
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('link de outra conta → OFFER_LINK_NOT_OWNED, sem chamar a Shein', async () => {
    const s = setup(WITH);
    await expect(s.uc.execute(TENANT, OTHER)).rejects.toMatchObject({ code: 'OFFER_LINK_NOT_OWNED' });
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('com credencial e sem aceite do aviso → MARKETPLACE_RISK_NOT_ACCEPTED (403), sem chamar a Shein', async () => {
    const s = setup(WITH, { accepted: false });
    await expect(s.uc.execute(TENANT, MINE)).rejects.toMatchObject({ code: 'MARKETPLACE_RISK_NOT_ACCEPTED', statusCode: 403 });
    expect(s.deps.riskGate.isAccepted).toHaveBeenCalledWith(TENANT, 'SHEIN');
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('sessão, link do próprio tenant: 1 chamada, mantém o colado e o produto vem da API (sem products.resolve)', async () => {
    const s = setup(WITH);
    const out = await s.uc.execute(TENANT, MINE);
    expect(s.deps.shein.getProductShare).toHaveBeenCalledTimes(1);
    expect(s.deps.shein.getProductShare).toHaveBeenCalledWith({ token: 'AT-TOKEN', memberId: '123456' }, '12345678');
    expect(out).toEqual({
      provider: 'SHEIN', sourceUrl: MINE, affiliateUrl: MINE, attributionVerified: true,
      product: { productRef: '12345678', title: 'Vestido Midi', priceCents: 2999, originalPriceCents: 5000, imageSourceUrl: SHARE.imageUrl },
    });
    expect(s.deps.products.resolve).not.toHaveBeenCalled();
    expect(s.pageReader.read).not.toHaveBeenCalled();
  });

  it('sessão, link sem afiliação: usa o shareLink gerado com attributionVerified = true', async () => {
    const s = setup(WITH);
    const out = await s.uc.execute(TENANT, PRODUCT);
    expect(out).toMatchObject({ affiliateUrl: SHARE.affiliateUrl, attributionVerified: true, product: { title: 'Vestido Midi' } });
    expect(s.deps.products.resolve).not.toHaveBeenCalled();
  });

  it('sessão, cliente devolve null: verificado segue com produto vazio; sem afiliação → OFFER_LINK_NOT_AFFILIATE', async () => {
    const s = setup(WITH);
    s.deps.shein.getProductShare.mockResolvedValue(null);
    const out = await s.uc.execute(TENANT, MINE);
    expect(out).toEqual({ provider: 'SHEIN', sourceUrl: MINE, affiliateUrl: MINE, attributionVerified: true, product: EMPTY });
    await expect(s.uc.execute(TENANT, PRODUCT)).rejects.toMatchObject({ code: 'OFFER_LINK_NOT_AFFILIATE' });
  });

  it('sem credencial: aceite não é exigido; link colado sem verificação e produto vazio; sem afiliação → erro', async () => {
    const s = setup({}, { accepted: false });
    const out = await s.uc.execute(TENANT, MINE);
    expect(out).toEqual({ provider: 'SHEIN', sourceUrl: MINE, affiliateUrl: MINE, attributionVerified: false, product: EMPTY });
    expect(s.deps.riskGate.isAccepted).not.toHaveBeenCalled();
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
    expect(s.pageReader.read).not.toHaveBeenCalled();
    await expect(s.uc.execute(TENANT, PRODUCT)).rejects.toMatchObject({ code: 'OFFER_LINK_NOT_AFFILIATE' });
  });

  it('sessão recusada pela Shein agora: AFFILIATE_CREDENTIAL_REJECTED propaga (sem pausar a loja aqui)', async () => {
    const s = setup(WITH);
    s.deps.shein.getProductShare.mockRejectedValueOnce(new AppError('AFFILIATE_CREDENTIAL_REJECTED', 'rejected', 401));
    await expect(s.uc.execute(TENANT, MINE)).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
    expect(s.deps.shein.getProductShare).toHaveBeenCalledTimes(1);
    expect(s.deps.credentials.markRejected).not.toHaveBeenCalled();
  });

  it('credencial já recusada: AFFILIATE_CREDENTIAL_REJECTED sem chamar a Shein nem marcar', async () => {
    const s = setup(WITH, { rejected: ['SHEIN'] });
    await expect(s.uc.execute(TENANT, MINE)).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
    expect(s.deps.riskGate.isAccepted).not.toHaveBeenCalled();
    expect(s.deps.credentials.markRejected).not.toHaveBeenCalled();
  });

  it('shareLink fora da allowlist: sem afiliação → OFFER_LINK_NOT_AFFILIATE; link do tenant segue com o colado', async () => {
    const s = setup(WITH);
    s.deps.shein.getProductShare.mockResolvedValue({ ...SHARE, affiliateUrl: 'https://evil.example/x' });
    await expect(s.uc.execute(TENANT, PRODUCT)).rejects.toMatchObject({ code: 'OFFER_LINK_NOT_AFFILIATE' });
    const out = await s.uc.execute(TENANT, MINE);
    expect(out).toMatchObject({ affiliateUrl: MINE, attributionVerified: true });
  });
});
