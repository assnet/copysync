import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorefrontNotFoundError } from '../../../../shared/errors/internal/StorefrontErrors';
import { ExtractStorefrontOfferUseCase } from './ExtractStorefrontOfferUseCase';
import { makeResolved, makeStorefrontDeps, MEDIA_URL, TENANT, type StorefrontFakes } from './storefrontTestFakes';
import { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import {
  AffiliateApiRateLimitedError,
  AffiliateApiUnavailableError,
  AffiliateCredentialRequiredError,
  OfferLinkRebuildFailedError,
} from '../../../../shared/errors/internal/OfferErrors';

const SHOPEE_REBUILT = makeResolved({
  provider: 'SHOPEE', sourceUrl: 'https://s.shopee.com.br/abc', affiliateUrl: 'https://s.shopee.com.br/meu', linkRebuilt: true,
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
    const { offer, linkRebuilt } = await useCase.execute({ ...input, category: 'pet_shop' });
    expect(linkRebuilt).toBe(false);
    expect(offer).toMatchObject({
      tenantId: TENANT, storefrontId: 'sf-1', status: StorefrontOfferStatus.DRAFT, position: 0, provider: 'MERCADO_LIVRE',
      sourceUrl: 'https://meli.la/abc', affiliateUrl: 'https://meli.la/abc', attributionVerified: true,
      title: 'Fone Bluetooth', priceCents: 9990, originalPriceCents: 12990, imageUrl: `${MEDIA_URL}1.webp`, category: 'pet_shop',
    });
    expect(fakes.resolveProduct.calls).toEqual([[TENANT, 'https://meli.la/abc']]);
    expect(fakes.imageFetcher.calls).toEqual(['https://img.example/p.jpg']);
    expect(fakes.images.calls).toEqual(['offer']);
  });

  it('nova oferta vai para o fim dos rascunhos', async () => {
    fakes.offers.seed({ position: 4 });
    fakes.offers.seed({ status: StorefrontOfferStatus.PUBLISHED, position: 9 });
    expect((await useCase.execute(input)).offer.position).toBe(5);
  });

  it('categoria fora das categorias da página vira "Sem categoria"', async () => {
    expect((await useCase.execute({ ...input, category: 'automotive' })).offer.category).toBeNull();
    expect((await useCase.execute({ ...input, category: 'inexistente' })).offer.category).toBeNull();
  });

  it('sem o plano responde PLAN_FEATURE_UNAVAILABLE sem resolver o link', async () => {
    fakes.entitlements.values = {};
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', meta: { key: ENTITLEMENT_KEYS.STOREFRONT_ENABLED } });
    expect(fakes.resolveProduct.calls).toEqual([]);
  });

  it('página excluída no meio da extração: o INSERT falha e a imagem recém-gravada é apagada (sem órfã)', async () => {
    vi.spyOn(fakes.offers, 'create').mockRejectedValueOnce(new StorefrontNotFoundError());
    await expect(useCase.execute(input)).rejects.toMatchObject({ code: 'STOREFRONT_NOT_FOUND' });
    expect(fakes.media.saved).toHaveLength(1);
    expect(fakes.media.removed).toEqual([`${MEDIA_URL}1.webp`]);
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

  it.each([
    new AffiliateCredentialRequiredError('SHOPEE'),
    new OfferLinkRebuildFailedError('MERCADO_LIVRE', 'ML_100'),
    new AffiliateApiRateLimitedError('SHOPEE'),
    new AffiliateApiUnavailableError('AMAZON'),
  ])('erro do link ($code) sobe sem gravar nem baixar imagem', async (error) => {
    fakes.resolveProduct.error = error;
    await expect(useCase.execute(input)).rejects.toBe(error);
    expect(fakes.offers.offers).toEqual([]);
    expect(fakes.imageFetcher.calls).toEqual([]);
  });

  it('link de outro afiliado recriado: grava o link do tenant como verificado e devolve linkRebuilt', async () => {
    fakes.resolveProduct.result = SHOPEE_REBUILT;
    const { offer, linkRebuilt } = await useCase.execute({ ...input, url: 'https://s.shopee.com.br/abc' });
    expect(linkRebuilt).toBe(true);
    expect(offer).toMatchObject({
      provider: 'SHOPEE', sourceUrl: 'https://s.shopee.com.br/abc', affiliateUrl: 'https://s.shopee.com.br/meu', attributionVerified: true,
    });
  });

  it('item novo nasce verificado mesmo se o resultado vier sem a marca', async () => {
    fakes.resolveProduct.result = makeResolved({ attributionVerified: false });
    expect((await useCase.execute(input)).offer.attributionVerified).toBe(true);
  });

  it('imagem não baixável não impede o rascunho', async () => {
    fakes.imageFetcher.result = null;
    expect((await useCase.execute(input)).offer.imageUrl).toBeNull();
  });

  it('falha ao processar ou gravar a imagem não impede o rascunho', async () => {
    fakes.images.error = new Error('sharp');
    expect((await useCase.execute(input)).offer.imageUrl).toBeNull();
    fakes.images.error = null;
    fakes.media.error = new Error('s3');
    expect((await useCase.execute(input)).offer.imageUrl).toBeNull();
  });

  it('produto sem foto não baixa nada', async () => {
    fakes.resolveProduct.result = makeResolved({ product: { ...makeResolved().product, imageSourceUrl: null } });
    expect((await useCase.execute(input)).offer.imageUrl).toBeNull();
    expect(fakes.imageFetcher.calls).toEqual([]);
  });

  it('título longo é cortado em 140 e título ausente vira vazio', async () => {
    fakes.resolveProduct.result = makeResolved({ product: { ...makeResolved().product, title: `  ${'a'.repeat(200)}  ` } });
    expect((await useCase.execute(input)).offer.title).toHaveLength(140);
    fakes.resolveProduct.result = makeResolved({ product: { ...makeResolved().product, title: null } });
    expect((await useCase.execute(input)).offer.title).toBe('');
  });
});
