import { describe, it, expect, vi } from 'vitest';
import { ResolveAffiliateProductUseCase } from './ResolveAffiliateProductUseCase';
import { ResolveProductDataUseCase } from './ResolveProductDataUseCase';
import { TENANT } from './offerTestFakes';
import type { OfferAffiliateCredential } from '../../domain/contracts/IAffiliateCredentialResolver';
import type { ProductPageData } from '../../domain/services/parseProductPage';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
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

function setup(creds: Partial<Record<AffiliateProvider, OfferAffiliateCredential>> = CREDS) {
  const imageFetcher = { fetch: vi.fn() };
  const mediaStore = { saveImage: vi.fn(), consumeUploadedImage: vi.fn(), removeImage: vi.fn() };
  const pageReader = { read: vi.fn().mockResolvedValue(PAGE) };
  const deps = {
    expander: { expand: vi.fn(async (u: URL) => u) },
    credentials: { execute: vi.fn(async (_t: string, p: AffiliateProvider) => creds[p] ?? null) },
    mercadoLivre: { createAffiliateLinks: vi.fn().mockResolvedValue({ success: [], errors: [] }), getActiveTag: vi.fn() },
    products: new ResolveProductDataUseCase({
      shopee: { getProduct: vi.fn(), generateShortLink: vi.fn() }, pageReader, imageFetcher, mediaStore,
    }),
  };
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
});
