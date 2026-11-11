import { describe, expect, it, vi } from 'vitest';
import { BuildTenantAffiliateLinkUseCase } from './BuildTenantAffiliateLinkUseCase';
import { TenantAffiliateLinkComposer } from '../services/TenantAffiliateLinkComposer';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { OfferAffiliateCredential } from '../../domain/contracts/IAffiliateCredentialResolver';
import type { AffiliateCredentialState } from '../../domain/contracts/IAffiliateCredentialGateway';
import { AppError } from '../../../../shared/errors/AppError';

const CREDS: Partial<Record<AffiliateProvider, OfferAffiliateCredential>> = {
  AMAZON: { provider: 'AMAZON', publicIdentifier: 'meu-20', secret: null },
  SHOPEE: { provider: 'SHOPEE', publicIdentifier: '123456', secret: 's3cr3t' },
  MERCADO_LIVRE: { provider: 'MERCADO_LIVRE', publicIdentifier: 'minhaetq', secret: null, session: { cookies: { ssid: 'x' } } },
  SHEIN: { provider: 'SHEIN', publicIdentifier: '123456', secret: null, session: { cookies: { AT: 'AT-TOKEN', memberId: '123456' } } },
};
const SHARE = {
  affiliateUrl: 'https://onelink.shein.com/1/meu', title: 'Vestido Midi', priceCents: 2999, originalPriceCents: 5000,
  imageUrl: 'https://img.ltwebstatic.com/images3/v.jpg',
};

function setup(creds = CREDS, opts: { ent?: Record<string, unknown>; accepted?: boolean } = {}) {
  const ent: Record<string, unknown> = opts.ent ?? { marketplace_shein_enabled: true };
  const deps = {
    expander: { expand: vi.fn(async (u: URL) => u) },
    credentials: {
      execute: vi.fn(async (_t: string, p: AffiliateProvider) => creds[p] ?? null),
      resolveState: vi.fn<(t: string, p: AffiliateProvider) => Promise<AffiliateCredentialState>>(async (_t, p) => (creds[p] ? { state: 'ok', cred: creds[p]! } : { state: 'missing' })),
      markRejected: vi.fn().mockResolvedValue(undefined),
    },
    shopee: { getProduct: vi.fn(), generateShortLink: vi.fn().mockResolvedValue('https://s.shopee.com.br/meu') },
    mercadoLivre: {
      createAffiliateLinks: vi.fn().mockResolvedValue({ success: [{ originUrl: '', shortUrl: 'https://meli.la/meu', longUrl: '' }], errors: [] }),
      getActiveTag: vi.fn(),
      listAccountTags: vi.fn(),
    },
    pageReader: { read: vi.fn().mockResolvedValue({ title: null, imageUrl: null, priceCents: null, originalPriceCents: null, productRef: 'MLB998877' }) },
    shein: { getProductShare: vi.fn().mockResolvedValue(SHARE) },
    entitlements: {
      getNumber: vi.fn(async () => null),
      getBoolean: vi.fn(async (_t: string, k: string) => (typeof ent[k] === 'boolean' ? (ent[k] as boolean) : null)),
    },
    riskGate: { isAccepted: vi.fn(async () => opts.accepted ?? true) },
  };
  return { deps, uc: new BuildTenantAffiliateLinkUseCase({ ...deps, composer: new TenantAffiliateLinkComposer(deps) }) };
}

describe('BuildTenantAffiliateLinkUseCase', () => {
  it('Amazon: URL canônica sem nada da origem + tag do tenant', async () => {
    const s = setup();
    const out = await s.uc.execute('t1', 'https://www.amazon.com.br/Fone-JBL/dp/B0ABCDEFGH/ref=x?tag=concorrente-20&psc=1');
    expect(out).toEqual({ kind: 'ok', provider: 'AMAZON', sourceUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH', affiliateUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=meu-20' });
  });

  it('Shopee: gera link curto com a credencial do tenant a partir da URL canônica', async () => {
    const s = setup();
    const out = await s.uc.execute('t1', 'https://shopee.com.br/Fone-i.111.222?af_siteid=concorrente&utm_source=x');
    expect(s.deps.shopee.generateShortLink).toHaveBeenCalledWith({ appId: '123456', secret: 's3cr3t' }, 'https://shopee.com.br/product/111/222');
    expect(out).toMatchObject({ kind: 'ok', affiliateUrl: 'https://s.shopee.com.br/meu' });
  });

  it('Mercado Livre item: gera pela sessão do tenant sem os parâmetros da origem', async () => {
    const s = setup();
    const out = await s.uc.execute('t1', 'https://produto.mercadolivre.com.br/MLB-123456-fone-_JM?matt_word=concorrente&matt_tool=1');
    expect(s.deps.mercadoLivre.createAffiliateLinks).toHaveBeenCalledWith({ ssid: 'x' }, ['https://produto.mercadolivre.com.br/MLB-123456'], 'minhaetq');
    expect(out).toMatchObject({ kind: 'ok', affiliateUrl: 'https://meli.la/meu' });
  });

  it('Mercado Livre social do concorrente: produto pela página, link do tenant', async () => {
    const s = setup();
    s.deps.expander.expand.mockResolvedValueOnce(new URL('https://www.mercadolivre.com.br/social/concorrente?matt_word=concorrente'));
    const out = await s.uc.execute('t1', 'https://meli.la/abc');
    expect(s.deps.pageReader.read).toHaveBeenCalledWith({ url: expect.any(URL) });
    expect(s.deps.mercadoLivre.createAffiliateLinks).toHaveBeenCalledWith({ ssid: 'x' }, ['https://www.mercadolivre.com.br/p/MLB998877'], 'minhaetq');
    expect(out).toMatchObject({ kind: 'ok' });
  });

  it('Mercado Livre social com item fora de catálogo: link pelo anúncio `produto…/MLB-`', async () => {
    const s = setup();
    s.deps.expander.expand.mockResolvedValueOnce(new URL('https://www.mercadolivre.com.br/social/concorrente?matt_word=concorrente&ref=abc'));
    s.deps.pageReader.read.mockResolvedValueOnce({ title: 'Kit', imageUrl: 'https://http2.mlstatic.com/x.webp', priceCents: 1, originalPriceCents: null, productRef: 'MLB1010954920', productRefCatalog: false });
    const out = await s.uc.execute('t1', 'https://meli.la/1vF5mAU');
    expect(s.deps.mercadoLivre.createAffiliateLinks).toHaveBeenCalledWith({ ssid: 'x' }, ['https://produto.mercadolivre.com.br/MLB-1010954920'], 'minhaetq');
    // Dados da vitrine seguem com o link: o monitoramento não relê a página do produto (captcha)
    expect(out).toMatchObject({ kind: 'ok', product: { title: 'Kit', priceCents: 1, originalPriceCents: null, imageUrl: 'https://http2.mlstatic.com/x.webp' } });
  });

  it('convite de grupo e site fora da allowlist: unsupported, sem rede', async () => {
    const s = setup();
    expect(await s.uc.execute('t1', 'https://chat.whatsapp.com/ABC')).toEqual({ kind: 'unsupported' });
    expect(await s.uc.execute('t1', 'nada')).toEqual({ kind: 'unsupported' });
    expect(s.deps.expander.expand).not.toHaveBeenCalled();
  });

  it('sem credencial do marketplace: credential_missing', async () => {
    const s = setup({});
    expect(await s.uc.execute('t1', 'https://www.amazon.com.br/dp/B0ABCDEFGH')).toEqual({ kind: 'credential_missing', provider: 'AMAZON' });
  });

  it('erro do client vira failed com o código; erro inesperado sobe', async () => {
    const s = setup();
    s.deps.shopee.generateShortLink.mockRejectedValueOnce(new AppError('AFFILIATE_API_UNAVAILABLE', 'x', 503));
    expect(await s.uc.execute('t1', 'https://shopee.com.br/product/1/2')).toMatchObject({ kind: 'failed', code: 'AFFILIATE_API_UNAVAILABLE' });
    s.deps.shopee.generateShortLink.mockRejectedValueOnce(new TypeError('bug'));
    await expect(s.uc.execute('t1', 'https://shopee.com.br/product/1/2')).rejects.toThrow(TypeError);
  });

  it('ML recusou a URL: failed com o código da ML', async () => {
    const s = setup();
    s.deps.mercadoLivre.createAffiliateLinks.mockResolvedValueOnce({ success: [], errors: [{ originUrl: '', errorCode: 100, message: 'URL Invalid' }] });
    expect(await s.uc.execute('t1', 'https://www.mercadolivre.com.br/fone/p/MLB777')).toMatchObject({ kind: 'failed', code: 'ML_100' });
  });

  it('ML sem link e sem erro por item: failed genérico', async () => {
    const s = setup();
    s.deps.mercadoLivre.createAffiliateLinks.mockResolvedValueOnce({ success: [], errors: [] });
    expect(await s.uc.execute('t1', 'https://www.mercadolivre.com.br/fone/p/MLB777')).toMatchObject({ kind: 'failed', code: 'AFFILIATE_LINK_NOT_CREATED' });
  });
});

describe('BuildTenantAffiliateLinkUseCase — credencial recusada', () => {
  const SINCE = new Date('2026-10-28T10:00:00.000Z');

  it('loja já recusada: credential_rejected sem chamar a loja', async () => {
    const s = setup();
    s.deps.credentials.resolveState.mockResolvedValueOnce({ state: 'rejected', since: SINCE, code: 'AFFILIATE_CREDENTIAL_REJECTED' });
    const out = await s.uc.execute('t1', 'https://www.mercadolivre.com.br/fone/p/MLB777');
    expect(out).toEqual({ kind: 'credential_rejected', provider: 'MERCADO_LIVRE', since: SINCE });
    expect(s.deps.mercadoLivre.createAffiliateLinks).not.toHaveBeenCalled();
    expect(s.deps.credentials.markRejected).not.toHaveBeenCalled();
  });

  it('loja recusa agora (AFFILIATE_CREDENTIAL_REJECTED): marca a rejeição e devolve credential_rejected', async () => {
    const s = setup();
    s.deps.shopee.generateShortLink.mockRejectedValueOnce(new AppError('AFFILIATE_CREDENTIAL_REJECTED', 'rejected', 422));
    const out = await s.uc.execute('t1', 'https://shopee.com.br/product/1/2');
    expect(out).toMatchObject({ kind: 'credential_rejected', provider: 'SHOPEE' });
    expect(s.deps.credentials.markRejected).toHaveBeenCalledWith('t1', 'SHOPEE', 'AFFILIATE_CREDENTIAL_REJECTED');
  });

  it('rate limit ou API fora não marcam rejeição: failed como antes', async () => {
    const s = setup();
    s.deps.shopee.generateShortLink.mockRejectedValueOnce(new AppError('AFFILIATE_API_RATE_LIMITED', 'slow', 429));
    expect(await s.uc.execute('t1', 'https://shopee.com.br/product/1/2')).toMatchObject({ kind: 'failed', code: 'AFFILIATE_API_RATE_LIMITED' });
    expect(s.deps.credentials.markRejected).not.toHaveBeenCalled();
  });

  it('ML, Shopee e Amazon nunca passam pelo gate de plano nem de aceite', async () => {
    const s = setup(CREDS, { ent: {}, accepted: false });
    expect(await s.uc.execute('t1', 'https://www.amazon.com.br/dp/B0ABCDEFGH')).toMatchObject({ kind: 'ok' });
    expect(await s.uc.execute('t1', 'https://shopee.com.br/product/1/2')).toMatchObject({ kind: 'ok' });
    expect(await s.uc.execute('t1', 'https://produto.mercadolivre.com.br/MLB-123456-fone')).toMatchObject({ kind: 'ok' });
    expect(s.deps.entitlements.getBoolean).not.toHaveBeenCalled();
    expect(s.deps.riskGate.isAccepted).not.toHaveBeenCalled();
  });
});

describe('BuildTenantAffiliateLinkUseCase — Shein', () => {
  const HREF = 'https://m.shein.com/br/Vestido-Midi-p-12345678-cat-1727.html?url_from=affiliate_koc_999999';

  it('ok: sourceUrl canônica só com o id, affiliateUrl = shareLink e product preenchido', async () => {
    const s = setup();
    const out = await s.uc.execute('t1', HREF);
    expect(s.deps.shein.getProductShare).toHaveBeenCalledWith({ token: 'AT-TOKEN', memberId: '123456' }, '12345678');
    expect(out).toEqual({
      kind: 'ok', provider: 'SHEIN', sourceUrl: 'https://br.shein.com/product-p-12345678.html', affiliateUrl: SHARE.affiliateUrl,
      product: { title: 'Vestido Midi', priceCents: 2999, originalPriceCents: 5000, imageUrl: SHARE.imageUrl },
    });
  });

  it('sem plano (chave ausente ou false): plan_unavailable antes de ler a credencial', async () => {
    for (const ent of [{}, { marketplace_shein_enabled: false }]) {
      const s = setup(CREDS, { ent });
      expect(await s.uc.execute('t1', HREF)).toEqual({ kind: 'plan_unavailable', provider: 'SHEIN' });
      expect(s.deps.credentials.resolveState).not.toHaveBeenCalled();
      expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
    }
  });

  it('sem plano + link curto `onelink`: plan_unavailable sem expandir; redirect até a Shein também trava', async () => {
    const s = setup(CREDS, { ent: {} });
    expect(await s.uc.execute('t1', 'https://onelink.shein.com/1/abc')).toEqual({ kind: 'plan_unavailable', provider: 'SHEIN' });
    expect(s.deps.expander.expand).not.toHaveBeenCalled();
    s.deps.expander.expand.mockResolvedValueOnce(new URL(HREF));
    expect(await s.uc.execute('t1', 'https://amzn.to/abc')).toEqual({ kind: 'plan_unavailable', provider: 'SHEIN' });
    expect(s.deps.expander.expand).toHaveBeenCalledTimes(1);
    expect(s.deps.credentials.resolveState).not.toHaveBeenCalled();
  });

  it('sem sessão (sem AT): credential_missing; sem credencial: credential_missing sem consultar o aceite', async () => {
    const noAt = setup({ SHEIN: { provider: 'SHEIN', publicIdentifier: '123456', secret: null, session: { cookies: { memberId: '123456' } } } });
    expect(await noAt.uc.execute('t1', HREF)).toEqual({ kind: 'credential_missing', provider: 'SHEIN' });
    const none = setup({}, { accepted: false });
    expect(await none.uc.execute('t1', HREF)).toEqual({ kind: 'credential_missing', provider: 'SHEIN' });
    expect(none.deps.riskGate.isAccepted).not.toHaveBeenCalled();
    expect(none.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('com credencial e sem aceite: risk_not_accepted sem chamar a Shein', async () => {
    const s = setup(CREDS, { accepted: false });
    expect(await s.uc.execute('t1', HREF)).toEqual({ kind: 'risk_not_accepted', provider: 'SHEIN' });
    expect(s.deps.riskGate.isAccepted).toHaveBeenCalledWith('t1', 'SHEIN');
    expect(s.deps.shein.getProductShare).not.toHaveBeenCalled();
  });

  it('sessão recusada: marca rejected e devolve credential_rejected', async () => {
    const s = setup();
    s.deps.shein.getProductShare.mockRejectedValueOnce(new AppError('AFFILIATE_CREDENTIAL_REJECTED', 'no', 401));
    expect(await s.uc.execute('t1', HREF)).toMatchObject({ kind: 'credential_rejected', provider: 'SHEIN' });
    expect(s.deps.credentials.markRejected).toHaveBeenCalledWith('t1', 'SHEIN', 'AFFILIATE_CREDENTIAL_REJECTED');
  });

  it('cliente devolve null ou shareLink fora da allowlist: failed SHEIN_LINK_NOT_CREATED', async () => {
    const s = setup();
    s.deps.shein.getProductShare.mockResolvedValueOnce(null);
    expect(await s.uc.execute('t1', HREF)).toEqual({ kind: 'failed', provider: 'SHEIN', code: 'SHEIN_LINK_NOT_CREATED' });
    for (const bad of ['https://evil.example.com/x', 'http://onelink.shein.com/1/x', 'não é url']) {
      s.deps.shein.getProductShare.mockResolvedValueOnce({ ...SHARE, affiliateUrl: bad });
      expect(await s.uc.execute('t1', HREF)).toEqual({ kind: 'failed', provider: 'SHEIN', code: 'SHEIN_LINK_NOT_CREATED' });
    }
  });
});

describe('BuildTenantAffiliateLinkUseCase — etiquetas vinculadas (TLINK-35)', () => {
  it('Mercado Livre com vinculadas no plano: o link do monitoramento sai com a principal', async () => {
    const ml = { ...CREDS.MERCADO_LIVRE!, accountIdentifiers: ['minhaetq', 'segunda'], linkedIdentifiers: ['segunda'] };
    const s = setup({ ...CREDS, MERCADO_LIVRE: ml });
    s.deps.entitlements.getNumber.mockImplementation(async () => 10 as never);
    await s.uc.execute('t1', 'https://produto.mercadolivre.com.br/MLB-123456-fone-_JM?matt_word=segunda');
    expect(s.deps.mercadoLivre.createAffiliateLinks).toHaveBeenCalledWith({ ssid: 'x' }, ['https://produto.mercadolivre.com.br/MLB-123456'], 'minhaetq');
  });
});
