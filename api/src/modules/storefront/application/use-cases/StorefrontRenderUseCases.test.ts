import { describe, it, expect, beforeEach } from 'vitest';
import { PreviewStorefrontUseCase, type PreviewStorefrontDTO } from './PreviewStorefrontUseCase';
import { RenderPublicStorefrontUseCase } from './RenderPublicStorefrontUseCase';
import {
  makeStorefront, makeStorefrontDeps, OTHER_TENANT, STOREFRONT_DOMAIN, STOREFRONT_HOST, TENANT, type StorefrontFakes,
} from './storefrontTestFakes';
import type { StorefrontUseCaseDeps } from './storefrontUseCaseDeps';
import { StorefrontOfferStatus, StorefrontStatus } from '../../domain/enums/StorefrontEnums';
import { STOREFRONT_DEFAULT_COLORS } from '../../domain/services/storefrontRules';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { PlanFeatureUnavailableError } from '../../../../shared/errors/internal/PlanErrors';

const { DRAFT, PUBLISHED } = StorefrontOfferStatus;

let fakes: StorefrontFakes;
let deps: Required<StorefrontUseCaseDeps>;

beforeEach(() => {
  ({ deps, fakes } = makeStorefrontDeps());
});

describe('PreviewStorefrontUseCase', () => {
  const draft = (over: Partial<PreviewStorefrontDTO['draft']> = {}): PreviewStorefrontDTO['draft'] => ({
    title: 'Rascunho', subtitle: 'Sub', colorPrimary: '#00ff00', colorBackground: '#F5F5F5', colorCard: '#FFFFFF',
    categories: ['electronics'], slug: 'rascunho', domainId: STOREFRONT_DOMAIN, ...over,
  });
  const preview = (over: Partial<PreviewStorefrontDTO> = {}) =>
    new PreviewStorefrontUseCase(deps).execute({ tenantId: TENANT, draft: draft(), viewport: 'mobile', ...over });

  it('sem plano → PLAN_FEATURE_UNAVAILABLE', async () => {
    fakes.entitlements.values = {};
    await expect(preview()).rejects.toBeInstanceOf(PlanFeatureUnavailableError);
  });

  it('sem página → exemplos (ofertas vazias), isPreview e viewport', async () => {
    const out = await preview();
    expect(out).toEqual({ html: '<page>Rascunho</page>' });
    const [{ model, opts }] = fakes.template.pages;
    expect(opts).toEqual({ isPreview: true, viewport: 'mobile' });
    expect(model.offers).toEqual([]);
    expect(model).toMatchObject({ title: 'Rascunho', subtitle: 'Sub', publicUrl: `https://rascunho.${STOREFRONT_HOST}` });
    expect(model.categories).toEqual([{ key: 'electronics', label: 'Eletrônicos' }]);
  });

  it('com página → só publicadas do tenant, na ordem, e imagens da página', async () => {
    fakes.storefronts.seed({ avatarUrl: 'https://media.example/a.webp', coverUrl: 'https://media.example/c.webp' });
    fakes.offers.seed({ status: PUBLISHED, position: 1, title: 'B', category: 'electronics' });
    fakes.offers.seed({ status: PUBLISHED, position: 0, title: 'A', category: 'pet_shop' });
    fakes.offers.seed({ status: DRAFT, title: 'rascunho' });
    fakes.offers.seed({ tenantId: OTHER_TENANT, status: PUBLISHED, title: 'alheia' });
    await preview();
    const { model } = fakes.template.pages[0];
    expect(model.offers.map((o) => o.title)).toEqual(['A', 'B']);
    // pet_shop não está no rascunho → "Sem categoria".
    expect(model.offers.map((o) => o.categoryKey)).toEqual([null, 'electronics']);
    expect(model.offers[1].categoryLabel).toBe('Eletrônicos');
    expect(model).toMatchObject({ avatarUrl: 'https://media.example/a.webp', coverUrl: 'https://media.example/c.webp' });
  });

  it('validação leve: cor inválida vira padrão, categoria estranha some, textos cortados', async () => {
    await preview({
      draft: draft({ colorPrimary: 'red;}', colorCard: '#abc', categories: ['x', 'pet_shop', 'pet_shop'], title: ' '.repeat(3) + 'a'.repeat(70), subtitle: 'b'.repeat(90) }),
    });
    const { model } = fakes.template.pages[0];
    expect(model.colors).toEqual({ primary: STOREFRONT_DEFAULT_COLORS.colorPrimary, background: '#F5F5F5', card: STOREFRONT_DEFAULT_COLORS.colorCard });
    expect(model.categories.map((c) => c.key)).toEqual(['pet_shop']);
    expect(model.title).toHaveLength(60);
    expect(model.subtitle).toHaveLength(80);
  });

  it('nome inválido/domínio desconhecido → publicUrl vazio, sem erro', async () => {
    await preview({ draft: draft({ slug: '!!', domainId: 'nao-existe' }) });
    expect(fakes.template.pages[0].model.publicUrl).toBe('');
  });
});

describe('RenderPublicStorefrontUseCase', () => {
  const address = { domainId: STOREFRONT_DOMAIN, slug: 'minhaloja' };
  const render = () => new RenderPublicStorefrontUseCase(deps).render(address);
  const publish = (tenantActive: boolean, over = {}) => {
    const storefront = makeStorefront(over);
    fakes.storefronts.publicByAddress.set(`${address.domainId}/${address.slug}`, { storefront, tenantActive });
    return storefront;
  };

  it('sem página → null (segue o fallback do hook)', async () => {
    expect(await render()).toBeNull();
  });

  it('tenant inativo → 503 página genérica', async () => {
    publish(false);
    expect(await render()).toEqual({ status: 503, html: '<unavailable>', styleHash: 'sha256-unavailable', cacheable: false });
  });

  it('pausada pelo plano → 200 pausada', async () => {
    publish(true, { status: StorefrontStatus.PAUSED_BY_PLAN });
    fakes.offers.seed({ status: PUBLISHED });
    expect(await render()).toEqual({ status: 200, html: '<paused>Minha Loja</paused>', styleHash: 'sha256-paused', cacheable: false });
  });

  it('ativa sem publicadas → 200 em breve', async () => {
    publish(true);
    fakes.offers.seed({ status: DRAFT });
    expect(await render()).toEqual({ status: 200, html: '<soon>Minha Loja</soon>', styleHash: 'sha256-soon', cacheable: false });
  });

  it('ativa com publicadas → 200 com ofertas, sem preview, cacheável', async () => {
    publish(true);
    fakes.offers.seed({ status: PUBLISHED, title: 'Fone' });
    const out = await render();
    expect(out).toEqual({ status: 200, html: '<page>Minha Loja</page>', styleHash: 'sha256-page', cacheable: true });
    const [{ model, opts }] = fakes.template.pages;
    expect(opts).toEqual({ isPreview: false });
    expect(model.offers.map((o) => o.title)).toEqual(['Fone']);
    expect(model.publicUrl).toBe(`https://minhaloja.${STOREFRONT_HOST}`);
  });
});
