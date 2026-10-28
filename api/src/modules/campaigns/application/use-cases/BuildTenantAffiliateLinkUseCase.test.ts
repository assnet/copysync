import { describe, expect, it, vi } from 'vitest';
import { BuildTenantAffiliateLinkUseCase } from './BuildTenantAffiliateLinkUseCase';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { OfferAffiliateCredential } from '../../domain/contracts/IAffiliateCredentialResolver';
import type { AffiliateCredentialState } from '../../domain/contracts/IAffiliateCredentialGateway';
import { AppError } from '../../../../shared/errors/AppError';

const CREDS: Partial<Record<AffiliateProvider, OfferAffiliateCredential>> = {
  AMAZON: { provider: 'AMAZON', publicIdentifier: 'meu-20', secret: null },
  SHOPEE: { provider: 'SHOPEE', publicIdentifier: '123456', secret: 's3cr3t' },
  MERCADO_LIVRE: { provider: 'MERCADO_LIVRE', publicIdentifier: 'minhaetq', secret: null, session: { cookies: { ssid: 'x' } } },
};

function setup(creds = CREDS) {
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
    },
    pageReader: { read: vi.fn().mockResolvedValue({ title: null, imageUrl: null, priceCents: null, originalPriceCents: null, productRef: 'MLB998877' }) },
  };
  return { deps, uc: new BuildTenantAffiliateLinkUseCase(deps) };
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
});
