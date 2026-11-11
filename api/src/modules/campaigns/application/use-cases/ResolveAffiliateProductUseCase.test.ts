import { describe, it, expect, vi } from 'vitest';
import { ResolveAffiliateProductUseCase } from './ResolveAffiliateProductUseCase';
import { ResolveProductDataUseCase } from './ResolveProductDataUseCase';
import { TenantAffiliateLinkComposer } from '../services/TenantAffiliateLinkComposer';
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

const SHEIN_CRED: OfferAffiliateCredential = {
  provider: 'SHEIN', publicIdentifier: '123456', secret: null, session: { cookies: { AT: 'AT-TOKEN', memberId: '123456' } },
};
const CREDS: Partial<Record<AffiliateProvider, OfferAffiliateCredential>> = {
  AMAZON: { provider: 'AMAZON', publicIdentifier: 'loja-20', secret: null },
  SHOPEE: { provider: 'SHOPEE', publicIdentifier: 'APP1', secret: 'S3CR3T' },
  MERCADO_LIVRE: { provider: 'MERCADO_LIVRE', publicIdentifier: 'minhaetq', secret: null, session: { cookies: { ssid: 'SSID-TOKEN' } } },
  SHEIN: SHEIN_CRED,
};
const SHARE = {
  affiliateUrl: 'https://onelink.shein.com/1/gerado', title: 'Vestido Midi', priceCents: 2999, originalPriceCents: 5000,
  imageUrl: 'https://img.ltwebstatic.com/images3/v.jpg',
};
const ML_LINK = 'https://meli.la/gerado';
const SHOPEE_LINK = 'https://s.shopee.com.br/dotenant';

function setup(
  creds: Partial<Record<AffiliateProvider, OfferAffiliateCredential>> = CREDS,
  opts: { ent?: Record<string, unknown>; accepted?: boolean; rejected?: AffiliateProvider[]; expand?: Record<string, string> } = {},
) {
  const ent: Record<string, unknown> = opts.ent ?? { marketplace_shein_enabled: true };
  const imageFetcher = { fetch: vi.fn() };
  const mediaStore = { saveImage: vi.fn(), consumeUploadedImage: vi.fn(), removeImage: vi.fn() };
  const pageReader = { read: vi.fn().mockResolvedValue(PAGE) };
  const shopee = { getProduct: vi.fn().mockResolvedValue(null), generateShortLink: vi.fn().mockResolvedValue(SHOPEE_LINK) };
  const mercadoLivre = {
    createAffiliateLinks: vi.fn().mockResolvedValue({ success: [{ originUrl: '', shortUrl: ML_LINK, longUrl: '' }], errors: [] }),
    getActiveTag: vi.fn(),
    listAccountTags: vi.fn(),
  };
  const shein = { getProductShare: vi.fn().mockResolvedValue(SHARE) };
  const riskGate = { isAccepted: vi.fn(async () => opts.accepted ?? true) };
  const credentials = {
    resolveState: vi.fn<(t: string, p: AffiliateProvider) => Promise<AffiliateCredentialState>>(async (_t, p) => {
      if (opts.rejected?.includes(p)) return { state: 'rejected', since: new Date(0), code: 'AFFILIATE_CREDENTIAL_REJECTED' };
      return creds[p] ? { state: 'ok', cred: creds[p]! } : { state: 'missing' };
    }),
    // Só para provar que o resolver nunca pausa a loja (não faz parte do tipo da dep)
    markRejected: vi.fn().mockResolvedValue(undefined),
  };
  const composer = new TenantAffiliateLinkComposer({ shopee, mercadoLivre, pageReader, shein, riskGate });
  const deps = {
    expander: { expand: vi.fn(async (u: URL) => (opts.expand?.[u.toString()] ? new URL(opts.expand[u.toString()]) : u)) },
    credentials,
    composer,
    products: new ResolveProductDataUseCase({ shopee, pageReader, imageFetcher, mediaStore }),
    shein,
    entitlements: {
      getNumber: vi.fn(async (_t: string, _k: string): Promise<number | null> => null),
      getBoolean: vi.fn(async (_t: string, k: string) => (typeof ent[k] === 'boolean' ? (ent[k] as boolean) : null)),
    },
    riskGate,
  };
  vi.spyOn(deps.products, 'resolve');
  vi.spyOn(composer, 'compose');
  return { deps, pageReader, imageFetcher, mediaStore, shopee, mercadoLivre, uc: new ResolveAffiliateProductUseCase(deps) };
}

const AMAZON = 'https://www.amazon.com.br/Fone/dp/B0ABCDEFGH/ref=sr_1?tag=loja-20';
const AMAZON_TENANT = 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=loja-20';
const ML_PLAIN = 'https://produto.mercadolivre.com.br/MLB-123456-fone';
const ML_CANON = 'https://produto.mercadolivre.com.br/MLB-123456';
const SHEIN_PRODUCT = 'https://br.shein.com/Vestido-Midi-p-12345678.html';
const SHEIN_MINE = `${SHEIN_PRODUCT}?url_from=affiliate_koc_123456`;
const SHEIN_OTHER = `${SHEIN_PRODUCT}?url_from=affiliate_koc_999999`;
const SHOPEE_PLAIN = 'https://shopee.com.br/Fone-i.111.222';

// ---------- Matriz: marketplace × forma do link × estado da credencial ----------

type Shape = 'outro_curto' | 'outro_longo' | 'limpo' | 'tenant_curto' | 'tenant_longo' | 'divergente';
interface Case {
  /** Link colado por forma; `expand` mapeia os curtos para a URL final. */
  links: Record<Shape, string>;
  expand: Record<string, string>;
  /** Link que o tenant deve receber quando recriado. */
  rebuilt: string;
  /** Marcas de identificador alheio que nunca podem sair no link. */
  foreign: string[];
}
const MATRIX: Record<AffiliateProvider, Case> = {
  SHOPEE: {
    links: {
      outro_curto: 'https://s.shopee.com.br/outro',
      outro_longo: `${SHOPEE_PLAIN}?af_siteid=outro999&utm_source=an_outro999`,
      limpo: SHOPEE_PLAIN,
      tenant_curto: 'https://s.shopee.com.br/meu',
      tenant_longo: `${SHOPEE_PLAIN}?af_siteid=APP1`,
      divergente: `${SHOPEE_PLAIN}?af_siteid=APP1&af_siteid=outro999`,
    },
    expand: {
      'https://s.shopee.com.br/outro': `${SHOPEE_PLAIN}?af_siteid=outro999`,
      'https://s.shopee.com.br/meu': `${SHOPEE_PLAIN}?af_siteid=APP1`,
    },
    rebuilt: SHOPEE_LINK,
    foreign: ['outro999', 's.shopee.com.br/outro'],
  },
  MERCADO_LIVRE: {
    links: {
      outro_curto: 'https://meli.la/outro',
      outro_longo: `${ML_PLAIN}?matt_word=outraetq`,
      limpo: ML_PLAIN,
      tenant_curto: 'https://meli.la/meu',
      tenant_longo: `${ML_PLAIN}?matt_word=minhaetq`,
      divergente: `${ML_PLAIN}?matt_word=minhaetq&matt_word=outraetq`,
    },
    expand: {
      'https://meli.la/outro': `${ML_PLAIN}?matt_word=outraetq`,
      'https://meli.la/meu': `${ML_PLAIN}?matt_word=minhaetq`,
    },
    rebuilt: ML_LINK,
    foreign: ['outraetq', 'meli.la/outro'],
  },
  AMAZON: {
    links: {
      outro_curto: 'https://amzn.to/outro',
      outro_longo: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=outro-20',
      limpo: 'https://www.amazon.com.br/dp/B0ABCDEFGH',
      tenant_curto: 'https://amzn.to/meu',
      tenant_longo: AMAZON,
      divergente: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=loja-20&tag=outro-20',
    },
    expand: {
      'https://amzn.to/outro': 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=outro-20',
      'https://amzn.to/meu': 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=loja-20',
    },
    rebuilt: AMAZON_TENANT,
    foreign: ['outro-20', 'amzn.to/outro'],
  },
  SHEIN: {
    links: {
      outro_curto: 'https://onelink.shein.com/1/outro',
      outro_longo: SHEIN_OTHER,
      limpo: SHEIN_PRODUCT,
      tenant_curto: 'https://onelink.shein.com/1/meu',
      tenant_longo: SHEIN_MINE,
      divergente: `${SHEIN_PRODUCT}?url_from=affiliate_koc_123456&url_from=affiliate_koc_999999`,
    },
    expand: {
      'https://onelink.shein.com/1/outro': SHEIN_OTHER,
      'https://onelink.shein.com/1/meu': SHEIN_MINE,
    },
    rebuilt: SHARE.affiliateUrl,
    foreign: ['999999', 'onelink.shein.com/1/outro'],
  },
};
const SHAPES: Shape[] = ['outro_curto', 'outro_longo', 'limpo', 'tenant_curto', 'tenant_longo', 'divergente'];
// Só o link curto oficial já do tenant é mantido; Amazon e Shopee (sem prova de dono) sempre recriam
const KEEPS = (p: AffiliateProvider, shape: Shape) => shape === 'tenant_curto' && (p === 'MERCADO_LIVRE' || p === 'SHEIN');

const CELLS = (Object.keys(MATRIX) as AffiliateProvider[]).flatMap((p) => SHAPES.map((shape) => [p, shape] as const));

describe('ResolveAffiliateProductUseCase — matriz (credencial ok)', () => {
  it.each(CELLS)('%s · %s → link do tenant, nunca o de terceiro', async (provider, shape) => {
    const c = MATRIX[provider];
    const pasted = c.links[shape];
    const s = setup(CREDS, { expand: c.expand });
    const out = await s.uc.execute(TENANT, pasted);
    const keep = KEEPS(provider, shape);
    expect(out).toMatchObject({
      provider, sourceUrl: pasted, attributionVerified: true, linkRebuilt: !keep,
      affiliateUrl: keep ? pasted : c.rebuilt,
    });
    for (const mark of c.foreign) expect(out.affiliateUrl).not.toContain(mark);
    expect(s.deps.credentials.markRejected).not.toHaveBeenCalled();
  });
});

describe('ResolveAffiliateProductUseCase — matriz (credencial ausente ou recusada)', () => {
  it.each(CELLS)('%s · %s sem credencial → AFFILIATE_CREDENTIAL_REQUIRED, nada pedido à loja', async (provider, shape) => {
    const c = MATRIX[provider];
    const s = setup({}, { expand: c.expand });
    await expect(s.uc.execute(TENANT, c.links[shape])).rejects.toMatchObject({
      code: 'AFFILIATE_CREDENTIAL_REQUIRED', statusCode: 422, meta: { provider },
    });
    expect(s.deps.composer.compose).not.toHaveBeenCalled();
    expect(s.deps.products.resolve).not.toHaveBeenCalled();
  });

  it.each(CELLS)('%s · %s recusada → AFFILIATE_CREDENTIAL_REJECTED sem marcar', async (provider, shape) => {
    const c = MATRIX[provider];
    const s = setup(CREDS, { expand: c.expand, rejected: [provider] });
    await expect(s.uc.execute(TENANT, c.links[shape])).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED', meta: { provider } });
    expect(s.deps.composer.compose).not.toHaveBeenCalled();
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
    expect(s.deps.credentials.markRejected).not.toHaveBeenCalled();
  });
});

// ---------- Casos pontuais ----------

describe('ResolveAffiliateProductUseCase', () => {
  it('Amazon do tenant: sempre reescrita na forma canônica com a tag; dados da página; foto só como URL externa', async () => {
    const s = setup();
    const out = await s.uc.execute(TENANT, `  ${AMAZON}  `);
    expect(out).toEqual({
      provider: 'AMAZON',
      sourceUrl: AMAZON,
      affiliateUrl: AMAZON_TENANT,
      attributionVerified: true,
      linkRebuilt: true,
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

  it('cupom/lista sem produto e sem loja conectada → OFFER_URL_UNSUPPORTED antes da credencial', async () => {
    const s = setup({});
    for (const url of [
      'https://amazon.com.br/s?k=fone&tag=outro-20',
      'https://lista.mercadolivre.com.br/fone-bluetooth',
      'https://www.mercadolivre.com.br/cupons',
      'https://shopee.com.br/m/cupom-de-desconto',
    ]) {
      await expect(s.uc.execute(TENANT, url)).rejects.toMatchObject({ code: 'OFFER_URL_UNSUPPORTED' });
    }
    expect(s.deps.credentials.resolveState).not.toHaveBeenCalled();
  });

  it('tag de outra conta → recriado com a tag do tenant, sem a de terceiro', async () => {
    const s = setup();
    const out = await s.uc.execute(TENANT, 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=outro-20');
    expect(out).toMatchObject({ affiliateUrl: AMAZON_TENANT, linkRebuilt: true });
  });

  it('sem credencial → AFFILIATE_CREDENTIAL_REQUIRED (D1), sem ler a página', async () => {
    const s = setup({});
    await expect(s.uc.execute(TENANT, AMAZON)).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REQUIRED', meta: { provider: 'AMAZON' } });
    expect(s.pageReader.read).not.toHaveBeenCalled();
  });

  it('ML sem afiliação com sessão: gera o link pela URL canônica e a principal', async () => {
    const s = setup();
    const out = await s.uc.execute(TENANT, ML_PLAIN);
    expect(out).toMatchObject({ provider: 'MERCADO_LIVRE', sourceUrl: ML_PLAIN, affiliateUrl: ML_LINK, attributionVerified: true, linkRebuilt: true });
    expect(s.mercadoLivre.createAffiliateLinks).toHaveBeenCalledWith({ ssid: 'SSID-TOKEN' }, [ML_CANON], 'minhaetq');
    expect(out.product.productRef).toBe('MLB123456');
  });

  it('ML: falha nunca vira NOT_AFFILIATE — vazio → REBUILD_FAILED; AppError da loja sobe; sem sessão → CREDENTIAL_REQUIRED', async () => {
    const s = setup();
    s.mercadoLivre.createAffiliateLinks.mockResolvedValueOnce({ success: [], errors: [{ originUrl: ML_CANON, errorCode: 100, errorMessage: 'x' }] });
    await expect(s.uc.execute(TENANT, ML_PLAIN)).rejects.toMatchObject({
      code: 'OFFER_LINK_REBUILD_FAILED', meta: { provider: 'MERCADO_LIVRE', reason: 'ML_100' },
    });
    s.mercadoLivre.createAffiliateLinks.mockResolvedValueOnce({ success: [], errors: [] });
    await expect(s.uc.execute(TENANT, ML_PLAIN)).rejects.toMatchObject({ code: 'OFFER_LINK_REBUILD_FAILED' });
    for (const code of ['AFFILIATE_API_RATE_LIMITED', 'AFFILIATE_API_UNAVAILABLE', 'AFFILIATE_CREDENTIAL_REJECTED']) {
      s.mercadoLivre.createAffiliateLinks.mockRejectedValueOnce(new AppError(code, 'x', 503));
      await expect(s.uc.execute(TENANT, ML_PLAIN)).rejects.toMatchObject({ code });
    }
    expect(s.deps.credentials.markRejected).not.toHaveBeenCalled();

    const noSession = setup({ MERCADO_LIVRE: { provider: 'MERCADO_LIVRE', publicIdentifier: 'minhaetq', secret: null } });
    await expect(noSession.uc.execute(TENANT, ML_PLAIN)).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REQUIRED' });
    expect(noSession.mercadoLivre.createAffiliateLinks).not.toHaveBeenCalled();
  });

  it('ML: erro que não é AppError na geração propaga', async () => {
    const s = setup();
    s.mercadoLivre.createAffiliateLinks.mockRejectedValueOnce(new TypeError('bug'));
    await expect(s.uc.execute(TENANT, ML_PLAIN)).rejects.toBeInstanceOf(TypeError);
  });

  it('link recriado fora da allowlist → OFFER_LINK_REBUILD_FAILED (Shopee, ML e Shein)', async () => {
    const s = setup();
    s.shopee.generateShortLink.mockResolvedValueOnce('https://evil.example/x');
    await expect(s.uc.execute(TENANT, SHOPEE_PLAIN)).rejects.toMatchObject({
      code: 'OFFER_LINK_REBUILD_FAILED', meta: { provider: 'SHOPEE', reason: 'NOT_ALLOWED' },
    });
    s.mercadoLivre.createAffiliateLinks.mockResolvedValueOnce({ success: [{ originUrl: '', shortUrl: 'http://meli.la/x', longUrl: '' }], errors: [] });
    await expect(s.uc.execute(TENANT, ML_PLAIN)).rejects.toMatchObject({ code: 'OFFER_LINK_REBUILD_FAILED', meta: { reason: 'NOT_ALLOWED' } });
    s.deps.shein.getProductShare.mockResolvedValueOnce({ ...SHARE, affiliateUrl: 'https://evil.example/x' });
    await expect(s.uc.execute(TENANT, SHEIN_PRODUCT)).rejects.toMatchObject({ code: 'OFFER_LINK_REBUILD_FAILED', meta: { provider: 'SHEIN' } });
  });

  it('Shopee: nunca mantém o colado; sem secret → AFFILIATE_CREDENTIAL_REQUIRED', async () => {
    const s = setup();
    const out = await s.uc.execute(TENANT, 'https://shopee.com.br/Fone-i.111.222');
    expect(out).toMatchObject({ affiliateUrl: SHOPEE_LINK, linkRebuilt: true, product: { productRef: '111.222', title: 'Air Fryer 4L' } });
    expect(s.shopee.generateShortLink).toHaveBeenCalledWith({ appId: 'APP1', secret: 'S3CR3T' }, 'https://shopee.com.br/product/111/222');
    const noSecret = setup({ SHOPEE: { provider: 'SHOPEE', publicIdentifier: 'APP1', secret: null } });
    await expect(noSecret.uc.execute(TENANT, SHOPEE_PLAIN)).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REQUIRED', meta: { provider: 'SHOPEE' } });
  });

  it('ML vitrine social curta do tenant: mantém o colado e usa o productRef da página', async () => {
    const s = setup();
    s.deps.expander.expand.mockResolvedValueOnce(
      new URL('https://www.mercadolivre.com.br/social/minhaetq?matt_word=minhaetq&matt_tool=63844234'),
    );
    s.pageReader.read.mockResolvedValueOnce({ ...PAGE, productRef: 'MLB999' });
    const out = await s.uc.execute(TENANT, 'https://meli.la/1Hb6zu6');
    expect(out).toMatchObject({
      provider: 'MERCADO_LIVRE', affiliateUrl: 'https://meli.la/1Hb6zu6', attributionVerified: true, linkRebuilt: false,
      product: { productRef: 'MLB999' },
    });
    expect(s.pageReader.read).toHaveBeenCalledWith(expect.objectContaining({ mercadoLivreCookies: { ssid: 'SSID-TOKEN' } }));
    expect(s.deps.composer.compose).not.toHaveBeenCalled();
  });

  it('ML meli.la → social com apelido do perfil ≠ etiqueta do tenant: verificado pelo matt_word e mantido', async () => {
    const s = setup();
    s.deps.expander.expand.mockResolvedValueOnce(
      new URL('https://www.mercadolivre.com.br/social/apelidodoperfil?matt_word=minhaetq&matt_tool=63844234'),
    );
    s.pageReader.read.mockResolvedValueOnce({ ...PAGE, productRef: 'MLB999' });
    const out = await s.uc.execute(TENANT, 'https://meli.la/2Xy9abc');
    expect(out).toMatchObject({
      provider: 'MERCADO_LIVRE', affiliateUrl: 'https://meli.la/2Xy9abc', attributionVerified: true, linkRebuilt: false,
      product: { productRef: 'MLB999' },
    });
    expect(s.mercadoLivre.createAffiliateLinks).not.toHaveBeenCalled();
  });

  it('ML vitrine social de outro com card: página lida uma vez, productRef do composer, dados do card', async () => {
    const s = setup();
    const pasted = 'https://www.mercadolivre.com.br/social/outro?matt_word=outraetq';
    s.pageReader.read.mockResolvedValueOnce({ ...PAGE, productRef: 'MLB777', productRefCatalog: true });
    const out = await s.uc.execute(TENANT, pasted);
    expect(out).toEqual({
      provider: 'MERCADO_LIVRE', sourceUrl: pasted, affiliateUrl: ML_LINK, attributionVerified: true, linkRebuilt: true,
      product: { productRef: 'MLB777', title: 'Air Fryer 4L', priceCents: 29990, originalPriceCents: 39990, imageSourceUrl: PAGE.imageUrl },
    });
    expect(s.pageReader.read).toHaveBeenCalledTimes(1);
    expect(s.deps.products.resolve).not.toHaveBeenCalled();
    expect(s.mercadoLivre.createAffiliateLinks).toHaveBeenCalledWith({ ssid: 'SSID-TOKEN' }, ['https://www.mercadolivre.com.br/p/MLB777'], 'minhaetq');
  });

  it('ML vitrine social de outro sem dado no card: relê pelo caminho de sempre e sobrepõe o productRef', async () => {
    const s = setup();
    const pasted = 'https://www.mercadolivre.com.br/social/outro?matt_word=outraetq';
    s.pageReader.read
      .mockResolvedValueOnce({ title: null, imageUrl: null, priceCents: null, originalPriceCents: null, productRef: 'MLB777' })
      .mockResolvedValueOnce({ ...PAGE, productRef: null });
    const out = await s.uc.execute(TENANT, pasted);
    expect(out).toMatchObject({ affiliateUrl: ML_LINK, product: { productRef: 'MLB777', title: 'Air Fryer 4L' } });
    expect(s.pageReader.read).toHaveBeenCalledTimes(2);
  });

  it('ML, Shopee e Amazon nunca passam pelo gate de plano nem de aceite', async () => {
    const s = setup(CREDS, { ent: {}, accepted: false });
    await s.uc.execute(TENANT, AMAZON);
    await s.uc.execute(TENANT, SHOPEE_PLAIN);
    await s.uc.execute(TENANT, ML_PLAIN);
    expect(s.deps.entitlements.getBoolean).not.toHaveBeenCalled();
    expect(s.deps.riskGate.isAccepted).not.toHaveBeenCalled();
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('todos os marketplaces leem a credencial por resolveState; recusa registrada bloqueia sem marcar', async () => {
    const s = setup(CREDS, { rejected: ['AMAZON'] });
    await expect(s.uc.execute(TENANT, AMAZON)).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
    expect(s.deps.credentials.resolveState).toHaveBeenCalledWith(TENANT, 'AMAZON');
    expect(s.deps.credentials.markRejected).not.toHaveBeenCalled();
    expect(s.pageReader.read).not.toHaveBeenCalled();
  });
});

describe('ResolveAffiliateProductUseCase — Shein', () => {
  const WITH = { SHEIN: SHEIN_CRED };
  const SHORT_MINE = 'https://onelink.shein.com/1/meu';
  const EMPTY = { productRef: '12345678', title: null, priceCents: null, originalPriceCents: null, imageSourceUrl: null };
  const FROM_SHARE = { productRef: '12345678', title: 'Vestido Midi', priceCents: 2999, originalPriceCents: 5000, imageSourceUrl: SHARE.imageUrl };
  const short = (creds = WITH, opts: { accepted?: boolean } = {}) => setup(creds, { ...opts, expand: { [SHORT_MINE]: SHEIN_MINE } });

  it('chave do plano ausente ou false bloqueia (PLAN_FEATURE_UNAVAILABLE) antes de ler a credencial', async () => {
    for (const ent of [{}, { marketplace_shein_enabled: false }]) {
      const s = setup(WITH, { ent });
      await expect(s.uc.execute(TENANT, SHEIN_MINE)).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', statusCode: 403 });
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
    s.deps.expander.expand.mockResolvedValueOnce(new URL(SHEIN_MINE));
    await expect(s.uc.execute(TENANT, 'https://amzn.to/abc')).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
    expect(s.deps.expander.expand).toHaveBeenCalledTimes(1);
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('link de outra conta → recriado com o shareLink do tenant', async () => {
    const s = setup(WITH);
    const out = await s.uc.execute(TENANT, SHEIN_OTHER);
    expect(out).toEqual({
      provider: 'SHEIN', sourceUrl: SHEIN_OTHER, affiliateUrl: SHARE.affiliateUrl, attributionVerified: true, linkRebuilt: true, product: FROM_SHARE,
    });
    expect(s.deps.shein.getProductShare).toHaveBeenCalledWith({ token: 'AT-TOKEN', memberId: '123456' }, '12345678');
  });

  it('com credencial e sem aceite do aviso → MARKETPLACE_RISK_NOT_ACCEPTED (403), sem chamar a Shein', async () => {
    const s = setup(WITH, { accepted: false });
    await expect(s.uc.execute(TENANT, SHEIN_MINE)).rejects.toMatchObject({ code: 'MARKETPLACE_RISK_NOT_ACCEPTED', statusCode: 403 });
    expect(s.deps.riskGate.isAccepted).toHaveBeenCalledWith(TENANT, 'SHEIN');
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('link longo do próprio tenant: recriado (D2), 1 chamada, produto da API (sem products.resolve)', async () => {
    const s = setup(WITH);
    const out = await s.uc.execute(TENANT, SHEIN_MINE);
    expect(s.deps.shein.getProductShare).toHaveBeenCalledTimes(1);
    expect(out).toEqual({
      provider: 'SHEIN', sourceUrl: SHEIN_MINE, affiliateUrl: SHARE.affiliateUrl, attributionVerified: true, linkRebuilt: true, product: FROM_SHARE,
    });
    expect(s.deps.products.resolve).not.toHaveBeenCalled();
    expect(s.pageReader.read).not.toHaveBeenCalled();
  });

  it('link curto do próprio tenant: mantém o colado; 1 chamada só para os dados', async () => {
    const s = short();
    const out = await s.uc.execute(TENANT, SHORT_MINE);
    expect(out).toEqual({
      provider: 'SHEIN', sourceUrl: SHORT_MINE, affiliateUrl: SHORT_MINE, attributionVerified: true, linkRebuilt: false, product: FROM_SHARE,
    });
    expect(s.deps.shein.getProductShare).toHaveBeenCalledTimes(1);
    expect(s.deps.composer.compose).not.toHaveBeenCalled();
    expect(s.pageReader.read).not.toHaveBeenCalled();
  });

  it('link sem afiliação: usa o shareLink gerado', async () => {
    const s = setup(WITH);
    const out = await s.uc.execute(TENANT, SHEIN_PRODUCT);
    expect(out).toMatchObject({ affiliateUrl: SHARE.affiliateUrl, linkRebuilt: true, product: { title: 'Vestido Midi' } });
    expect(s.deps.products.resolve).not.toHaveBeenCalled();
  });

  it('cliente devolve null: curto mantido segue com produto vazio; recriar → OFFER_LINK_REBUILD_FAILED', async () => {
    const s = short();
    s.deps.shein.getProductShare.mockResolvedValue(null);
    const out = await s.uc.execute(TENANT, SHORT_MINE);
    expect(out).toEqual({ provider: 'SHEIN', sourceUrl: SHORT_MINE, affiliateUrl: SHORT_MINE, attributionVerified: true, linkRebuilt: false, product: EMPTY });
    await expect(s.uc.execute(TENANT, SHEIN_PRODUCT)).rejects.toMatchObject({
      code: 'OFFER_LINK_REBUILD_FAILED', meta: { provider: 'SHEIN', reason: 'SHEIN_LINK_NOT_CREATED' },
    });
  });

  it('sem credencial: AFFILIATE_CREDENTIAL_REQUIRED antes do aceite, sem chamar a Shein', async () => {
    const s = setup({}, { accepted: false });
    await expect(s.uc.execute(TENANT, SHEIN_MINE)).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REQUIRED', meta: { provider: 'SHEIN' } });
    expect(s.deps.riskGate.isAccepted).not.toHaveBeenCalled();
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
    expect(s.pageReader.read).not.toHaveBeenCalled();
  });

  it('credencial sem AT: curto mantido com produto vazio sem chamar; recriar → AFFILIATE_CREDENTIAL_REQUIRED', async () => {
    const noAt = { SHEIN: { ...SHEIN_CRED, session: { cookies: { memberId: '123456' } } } };
    const s = short(noAt);
    await expect(s.uc.execute(TENANT, SHORT_MINE)).resolves.toMatchObject({ affiliateUrl: SHORT_MINE, product: EMPTY });
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
    await expect(s.uc.execute(TENANT, SHEIN_PRODUCT)).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REQUIRED' });
  });

  it('sessão recusada pela Shein agora: AFFILIATE_CREDENTIAL_REJECTED propaga (sem pausar a loja aqui)', async () => {
    const s = setup(WITH);
    s.deps.shein.getProductShare.mockRejectedValueOnce(new AppError('AFFILIATE_CREDENTIAL_REJECTED', 'rejected', 401));
    await expect(s.uc.execute(TENANT, SHEIN_MINE)).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
    expect(s.deps.shein.getProductShare).toHaveBeenCalledTimes(1);
    expect(s.deps.credentials.markRejected).not.toHaveBeenCalled();
  });

  it('credencial já recusada: AFFILIATE_CREDENTIAL_REJECTED sem chamar a Shein nem marcar', async () => {
    const s = setup(WITH, { rejected: ['SHEIN'] });
    await expect(s.uc.execute(TENANT, SHEIN_MINE)).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REJECTED' });
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
    expect(s.deps.riskGate.isAccepted).not.toHaveBeenCalled();
    expect(s.deps.credentials.markRejected).not.toHaveBeenCalled();
  });

  it('shareLink fora da allowlist: recriar → REBUILD_FAILED; curto do tenant segue com o colado', async () => {
    const s = short();
    s.deps.shein.getProductShare.mockResolvedValue({ ...SHARE, affiliateUrl: 'https://evil.example/x' });
    await expect(s.uc.execute(TENANT, SHEIN_PRODUCT)).rejects.toMatchObject({ code: 'OFFER_LINK_REBUILD_FAILED' });
    const out = await s.uc.execute(TENANT, SHORT_MINE);
    expect(out).toMatchObject({ affiliateUrl: SHORT_MINE, attributionVerified: true, linkRebuilt: false });
  });
});

describe('ResolveAffiliateProductUseCase — etiquetas da conta ML por plano', () => {
  const KEY = 'mercado_livre_affiliate_tags';
  const link = (tag: string) => `${ML_PLAIN}?matt_word=${tag}`;
  const mlCred = (linked: string[], account = ['minhaetq', 'segunda', 'terceira', 'quarta']): OfferAffiliateCredential => ({
    ...CREDS.MERCADO_LIVRE!, accountIdentifiers: account, linkedIdentifiers: linked,
  });
  const withLimit = (cred: OfferAffiliateCredential, limit: number | null, expand?: Record<string, string>) => {
    const s = setup({ MERCADO_LIVRE: cred }, { expand });
    s.deps.entitlements.getNumber.mockImplementation(async (_t: string, k: string) => (k === KEY ? limit : null));
    return s;
  };

  it('LITE (1) com etiqueta da conta não vinculada → PLAN_LIMIT_REACHED com a chave, sem ler a página nem recriar', async () => {
    const s = withLimit(mlCred([]), 1);
    await expect(s.uc.execute(TENANT, link('segunda'))).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED', meta: { key: KEY, limit: 1 },
    });
    expect(s.deps.entitlements.getNumber).toHaveBeenCalledWith(TENANT, KEY);
    expect(s.pageReader.read).not.toHaveBeenCalled();
    expect(s.mercadoLivre.createAffiliateLinks).not.toHaveBeenCalled();
  });

  it('PRO (2) sem vinculadas → AFFILIATE_IDENTIFIER_NOT_LINKED (limit 2, used 1), sem a etiqueta no meta', async () => {
    const s = withLimit(mlCred([]), 2);
    const err = await s.uc.execute(TENANT, link('Segunda')).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'AFFILIATE_IDENTIFIER_NOT_LINKED', statusCode: 422, meta: { provider: 'MERCADO_LIVRE', limit: 2, used: 1 } });
    expect(JSON.stringify((err as AppError).meta)).not.toContain('egunda');
    expect(s.mercadoLivre.createAffiliateLinks).not.toHaveBeenCalled();
  });

  it('PRO com a 2ª vinculada, link longo → recriado com a etiqueta do link (mlTag), não a principal', async () => {
    const s = withLimit(mlCred(['segunda']), 2);
    const out = await s.uc.execute(TENANT, link('Segunda'));
    expect(out).toMatchObject({ provider: 'MERCADO_LIVRE', affiliateUrl: ML_LINK, attributionVerified: true, linkRebuilt: true });
    expect(s.mercadoLivre.createAffiliateLinks).toHaveBeenCalledWith({ ssid: 'SSID-TOKEN' }, [ML_CANON], 'segunda');
  });

  it('PRO com a 2ª vinculada, link curto → mantém o colado', async () => {
    const s = withLimit(mlCred(['segunda']), 2, { 'https://meli.la/seg': link('segunda') });
    const out = await s.uc.execute(TENANT, 'https://meli.la/seg');
    expect(out).toMatchObject({ affiliateUrl: 'https://meli.la/seg', linkRebuilt: false });
    expect(s.mercadoLivre.createAffiliateLinks).not.toHaveBeenCalled();
  });

  it('rebaixado (MAX→LITE) com 3 vinculadas gravadas: só a principal vale', async () => {
    const s = withLimit(mlCred(['segunda', 'terceira', 'quarta']), 1);
    await expect(s.uc.execute(TENANT, link('minhaetq'))).resolves.toMatchObject({ attributionVerified: true, linkRebuilt: true });
    expect(s.mercadoLivre.createAffiliateLinks).toHaveBeenLastCalledWith({ ssid: 'SSID-TOKEN' }, [ML_CANON], 'minhaetq');
    await expect(s.uc.execute(TENANT, link('segunda'))).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: KEY, limit: 1 } });
  });

  it('etiqueta de terceiro (fora da conta) → recriado com a principal', async () => {
    const s = withLimit(mlCred([]), 10);
    const out = await s.uc.execute(TENANT, link('alheia'));
    expect(out).toMatchObject({ affiliateUrl: ML_LINK, linkRebuilt: true });
    expect(s.mercadoLivre.createAffiliateLinks).toHaveBeenCalledWith({ ssid: 'SSID-TOKEN' }, [ML_CANON], 'minhaetq');
  });

  it('tenant sem a chave (getNumber null) → limite 1', async () => {
    const s = withLimit(mlCred(['segunda']), null);
    await expect(s.uc.execute(TENANT, link('segunda'))).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', meta: { key: KEY, limit: 1 } });
  });

  it('link sem afiliação com vinculadas: o link gerado usa a principal', async () => {
    const s = withLimit(mlCred(['segunda']), 2);
    await s.uc.execute(TENANT, ML_PLAIN);
    expect(s.mercadoLivre.createAffiliateLinks).toHaveBeenCalledWith({ ssid: 'SSID-TOKEN' }, [ML_CANON], 'minhaetq');
  });

  // Antes (FE): principal vazia → credencial não resolve → link colado passava sem verificação (risco aceito).
  // Com a F1 (D1, sem credencial bloqueia) este caso muda de propósito.
  it('ML com principal vazia (credencial não resolve) → AFFILIATE_CREDENTIAL_REQUIRED', async () => {
    const s = setup({});
    await expect(s.uc.execute(TENANT, link('segunda'))).rejects.toMatchObject({ code: 'AFFILIATE_CREDENTIAL_REQUIRED' });
    expect(s.deps.entitlements.getNumber).not.toHaveBeenCalledWith(TENANT, KEY);
    expect(s.mercadoLivre.createAffiliateLinks).not.toHaveBeenCalled();
  });

  it('outro marketplace não consulta o limite de etiquetas', async () => {
    const s = setup();
    await s.uc.execute(TENANT, AMAZON);
    expect(s.deps.entitlements.getNumber).not.toHaveBeenCalledWith(TENANT, KEY);
  });
});
