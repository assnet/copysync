import { describe, it, expect, beforeEach } from 'vitest';
import { ExtractStorefrontOfferUseCase } from './ExtractStorefrontOfferUseCase';
import { makeResolved, makeStorefrontDeps, MEDIA_URL, TENANT, type StorefrontFakes } from './storefrontTestFakes';
import { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { OfferLinkNotOwnedError } from '../../../../shared/errors/internal/OfferErrors';
import { AppError } from '../../../../shared/errors/AppError';

const SHOPEE = makeResolved({
  provider: 'SHOPEE', sourceUrl: 'https://s.shopee.com.br/abc', affiliateUrl: 'https://s.shopee.com.br/abc', attributionVerified: false,
});

describe('ExtractStorefrontOfferUseCase', () => {
  let fakes: StorefrontFakes;
  let useCase: ExtractStorefrontOfferUseCase;
  const input = { tenantId: TENANT, url: 'https://meli.la/abc' };

  beforeEach(() => {
    const made = makeStorefrontDeps();
    fakes = made.fakes;
    useCase = new ExtractStorefrontOfferUseCase(made.deps);
    fakes.storefronts.seed();
  });

  it('cria rascunho com dados do produto, imagem processada e link resolvido', async () => {
    const offer = await useCase.execute({ ...input, category: 'pet_shop' });
    expect(offer).toMatchObject({
      tenantId: TENANT, storefrontId: 'sf-1', status: StorefrontOfferStatus.DRAFT, position: 0, provider: 'MERCADO_LIVRE',
      sourceUrl: 'https://meli.la/abc', affiliateUrl: 'https://meli.la/abc', attributionVerified: true,
      title: 'Fone Bluetooth', priceCents: 9990, originalPriceCents: 12990, imageUrl: `${MEDIA_URL}1.webp`, category: 'pet_shop',
    });
    expect(fakes.resolveProduct.calls).toEqual([[TENANT, 'https://meli.la/abc']]);
    expect(fakes.imageFetcher.calls).toEqual(['https://img.example/p.jpg']);
    expect(fakes.images.calls).toEqual(['offer']);
    expect(fakes.buildAffiliateLink.calls).toEqual([]);
  });

  it('nova oferta vai para o fim dos rascunhos', async () => {
    fakes.offers.seed({ position: 4 });
    fakes.offers.seed({ status: StorefrontOfferStatus.PUBLISHED, position: 9 });
    expect((await useCase.execute(input)).position).toBe(5);
  });

  it('categoria fora das categorias da página vira "Sem categoria"', async () => {
    expect((await useCase.execute({ ...input, category: 'automotive' })).category).toBeNull();
    expect((await useCase.execute({ ...input, category: 'inexistente' })).category).toBeNull();
  });

  it('sem o plano responde PLAN_FEATURE_UNAVAILABLE sem resolver o link', async () => {
    fakes.entitlements.values = {};
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: ENTITLEMENT_KEYS.STOREFRONT_ENABLED } });
    expect(fakes.resolveProduct.calls).toEqual([]);
  });

  it('sem página responde STOREFRONT_NOT_FOUND', async () => {
    fakes.storefronts.pages = [];
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'STOREFRONT_NOT_FOUND' });
  });

  it('com 200 ofertas responde STOREFRONT_OFFER_LIMIT antes de resolver', async () => {
    for (let i = 0; i < 200; i++) fakes.offers.seed({ position: i });
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'STOREFRONT_OFFER_LIMIT', meta: { limit: 200 } });
    expect(fakes.resolveProduct.calls).toEqual([]);
  });

  it('erro de regra do link sobe sem gravar', async () => {
    fakes.resolveProduct.error = new OfferLinkNotOwnedError('MERCADO_LIVRE');
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'OFFER_LINK_NOT_OWNED' });
    expect(fakes.offers.offers).toEqual([]);
  });

  it('Shopee com credencial grava o link gerado do tenant como verificado', async () => {
    fakes.resolveProduct.result = SHOPEE;
    fakes.buildAffiliateLink.result = {
      kind: 'ok', provider: 'SHOPEE', sourceUrl: 'https://shopee.com.br/product/1/2', affiliateUrl: 'https://s.shopee.com.br/meu',
    };
    const offer = await useCase.execute({ ...input, url: 'https://s.shopee.com.br/abc' });
    expect(fakes.buildAffiliateLink.calls).toEqual([[TENANT, 'https://s.shopee.com.br/abc']]);
    expect(offer).toMatchObject({ sourceUrl: 'https://s.shopee.com.br/abc', affiliateUrl: 'https://s.shopee.com.br/meu', attributionVerified: true });
  });

  it.each([
    { kind: 'credential_missing', provider: 'SHOPEE' },
    { kind: 'credential_rejected', provider: 'SHOPEE', since: new Date() },
    { kind: 'failed', provider: 'SHOPEE', code: 'X' },
    { kind: 'unsupported' },
  ] as const)('Shopee com resultado %o grava o link colado sem verificação', async (result) => {
    fakes.resolveProduct.result = SHOPEE;
    fakes.buildAffiliateLink.result = result;
    const offer = await useCase.execute(input);
    expect(offer).toMatchObject({ affiliateUrl: 'https://s.shopee.com.br/abc', attributionVerified: false });
  });

  it('Shopee com erro inesperado na geração grava o link colado sem verificação', async () => {
    fakes.resolveProduct.result = SHOPEE;
    fakes.buildAffiliateLink.error = new Error('boom');
    const offer = await useCase.execute(input);
    expect(offer).toMatchObject({ affiliateUrl: 'https://s.shopee.com.br/abc', attributionVerified: false });
  });

  it('Shopee com AppError na geração sobe o erro', async () => {
    fakes.resolveProduct.result = SHOPEE;
    fakes.buildAffiliateLink.error = new AppError('X', 'x', 500);
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'X' });
  });

  it('imagem não baixável não impede o rascunho', async () => {
    fakes.imageFetcher.result = null;
    expect((await useCase.execute(input)).imageUrl).toBeNull();
  });

  it('falha ao processar ou gravar a imagem não impede o rascunho', async () => {
    fakes.images.error = new Error('sharp');
    expect((await useCase.execute(input)).imageUrl).toBeNull();
    fakes.images.error = null;
    fakes.media.error = new Error('s3');
    expect((await useCase.execute(input)).imageUrl).toBeNull();
  });

  it('produto sem foto não baixa nada', async () => {
    fakes.resolveProduct.result = makeResolved({ product: { ...makeResolved().product, imageSourceUrl: null } });
    expect((await useCase.execute(input)).imageUrl).toBeNull();
    expect(fakes.imageFetcher.calls).toEqual([]);
  });

  it('título longo é cortado em 140 e título ausente vira vazio', async () => {
    fakes.resolveProduct.result = makeResolved({ product: { ...makeResolved().product, title: `  ${'a'.repeat(200)}  ` } });
    expect((await useCase.execute(input)).title).toHaveLength(140);
    fakes.resolveProduct.result = makeResolved({ product: { ...makeResolved().product, title: null } });
    expect((await useCase.execute(input)).title).toBe('');
  });
});
