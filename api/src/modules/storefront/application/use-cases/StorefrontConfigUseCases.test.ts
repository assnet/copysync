import { describe, it, expect, beforeEach } from 'vitest';
import { GetStorefrontUseCase } from './GetStorefrontUseCase';
import { CheckStorefrontSlugUseCase } from './CheckStorefrontSlugUseCase';
import { SaveStorefrontUseCase, type SaveStorefrontDTO } from './SaveStorefrontUseCase';
import {
  makeStorefrontDeps, NOW, OTHER_TENANT, seedPageWithClaim, STOREFRONT_DOMAIN, STOREFRONT_HOST, TENANT, type StorefrontFakes,
} from './storefrontTestFakes';
import type { StorefrontUseCaseDeps } from './storefrontUseCaseDeps';
import { makeDomain } from '../../../link-rotation/application/use-cases/linkRotationTestFakes';
import { LinkDomainStatus, LinkRotationStrategy } from '../../../link-rotation/domain/enums/LinkRotationEnums';
import { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';
import { STOREFRONT_CATEGORIES } from '../../domain/services/storefrontCategories';
import { STOREFRONT_SUBTITLE_SUGGESTIONS } from '../../domain/services/storefrontRules';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import { PlanFeatureUnavailableError } from '../../../../shared/errors/internal/PlanErrors';
import { StorefrontSlugPremiumError } from '../../../../shared/errors/internal/StorefrontErrors';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import {
  LinkDomainInvalidError, LinkSlugInvalidError, LinkSlugReservedError, LinkSlugTakenError,
} from '../../../../shared/errors/internal/LinkRotationErrors';

const { DRAFT, PUBLISHED } = StorefrontOfferStatus;

let fakes: StorefrontFakes;
let deps: Required<StorefrontUseCaseDeps>;

beforeEach(() => {
  ({ deps, fakes } = makeStorefrontDeps());
});

const addRotation = (slug: string) => fakes.rotations.create({
  tenantId: TENANT, sessionId: 'session-1', domainId: STOREFRONT_DOMAIN, slug, strategy: LinkRotationStrategy.BALANCED, title: null,
});
const lockPlan = () => { fakes.entitlements.values = { [ENTITLEMENT_KEYS.STOREFRONT_ENABLED]: false }; };

describe('GetStorefrontUseCase', () => {
  it('sem plano → PLAN_FEATURE_UNAVAILABLE', async () => {
    lockPlan();
    await expect(new GetStorefrontUseCase(deps).execute(TENANT)).rejects.toBeInstanceOf(PlanFeatureUnavailableError);
  });

  it('sem página → storefront null com catálogo, sugestões e domínios ativos', async () => {
    fakes.domains.items.push(makeDomain({ id: 'dom-off', hostname: 'off.example', status: LinkDomainStatus.PAUSED }));
    const out = await new GetStorefrontUseCase(deps).execute(TENANT);
    expect(out.storefront).toBeNull();
    expect(out.publicUrl).toBeNull();
    expect(out.offers).toEqual({ drafts: [], published: [] });
    expect(out.categories).toEqual(STOREFRONT_CATEGORIES.map((c) => ({ key: c.key, label: c.label })));
    expect(out.subtitleSuggestions).toEqual(STOREFRONT_SUBTITLE_SUGGESTIONS);
    expect(out.domains).toEqual([{ id: STOREFRONT_DOMAIN, hostname: STOREFRONT_HOST }]);
  });

  it('com página → ofertas por aba (ordem) e publicUrl https://<slug>.<hostname>', async () => {
    const page = seedPageWithClaim(fakes);
    fakes.offers.seed({ status: PUBLISHED, position: 1, title: 'P2' });
    fakes.offers.seed({ status: PUBLISHED, position: 0, title: 'P1' });
    fakes.offers.seed({ status: DRAFT, title: 'D1' });
    fakes.offers.seed({ tenantId: OTHER_TENANT, status: DRAFT, title: 'alheia' });
    const out = await new GetStorefrontUseCase(deps).execute(TENANT);
    expect(out.storefront?.id).toBe(page.id);
    expect(out.publicUrl).toBe(`https://minhaloja.${STOREFRONT_HOST}`);
    expect(out.offers.published.map((o) => o.title)).toEqual(['P1', 'P2']);
    expect(out.offers.drafts.map((o) => o.title)).toEqual(['D1']);
  });

  it('página sem endereço (claim ausente) → publicUrl null', async () => {
    fakes.storefronts.seed({ address: null });
    const out = await new GetStorefrontUseCase(deps).execute(TENANT);
    expect(out.storefront).not.toBeNull();
    expect(out.publicUrl).toBeNull();
  });
});

describe('CheckStorefrontSlugUseCase', () => {
  const check = (slug: string, domainId?: string) => new CheckStorefrontSlugUseCase(deps).execute({ tenantId: TENANT, slug, domainId });

  it('sem plano → PLAN_FEATURE_UNAVAILABLE', async () => {
    lockPlan();
    await expect(check('livre')).rejects.toBeInstanceOf(PlanFeatureUnavailableError);
  });

  it('nome livre → AVAILABLE normalizado, sem sugestões', async () => {
    expect(await check('Minha-Loja')).toMatchObject({ status: 'AVAILABLE', slug: 'minha-loja', suggestions: [] });
  });

  it('formato inválido → INVALID', async () => {
    expect((await check('!!')).status).toBe('INVALID');
  });

  it('nome da própria página → OWNED', async () => {
    seedPageWithClaim(fakes);
    expect(await check('minhaloja')).toMatchObject({ status: 'OWNED', suggestions: [] });
  });

  it('nome de rodízio do próprio tenant → TAKEN com sugestões (não é da página)', async () => {
    await addRotation('meulink');
    const out = await check('meulink');
    expect(out.status).toBe('TAKEN');
    expect(out.suggestions.length).toBeGreaterThan(0);
    expect(out).not.toHaveProperty('owner');
  });

  it('nome de outro tenant → TAKEN com sugestões', async () => {
    fakes.slugs.storefronts.push({ tenantId: OTHER_TENANT, domainId: STOREFRONT_DOMAIN, slug: 'alheia', ownerId: 'sf-x' });
    const out = await check('alheia');
    expect(out.status).toBe('TAKEN');
    expect(out.suggestions.length).toBeGreaterThan(0);
  });

  it('nome reservado pelo domínio → RESERVED (NAME)', async () => {
    fakes.domains.items[0].reservedNames = ['vip'];
    expect(await check('vip')).toMatchObject({ status: 'RESERVED', reservedReason: 'NAME' });
  });

  it('nome especial sem concessão → PREMIUM', async () => {
    fakes.domains.items[0].premiumNames = ['ofertas'];
    expect((await check('ofertas')).status).toBe('PREMIUM');
  });

  it('sem domainId usa o domínio da página; domainId inativo → LINK_DOMAIN_INVALID', async () => {
    fakes.domains.items.push(makeDomain({ id: 'dom-off', hostname: 'off.example', status: LinkDomainStatus.PAUSED }));
    await expect(check('livre', 'dom-off')).rejects.toBeInstanceOf(LinkDomainInvalidError);
    seedPageWithClaim(fakes);
    expect((await check('minhaloja')).status).toBe('OWNED');
  });

  it('nenhum domínio ativo → LINK_DOMAIN_INVALID', async () => {
    fakes.domains.items = [];
    await expect(check('livre')).rejects.toBeInstanceOf(LinkDomainInvalidError);
  });
});

describe('SaveStorefrontUseCase', () => {
  const dto = (over: Partial<SaveStorefrontDTO> = {}): SaveStorefrontDTO => ({
    tenantId: TENANT, domainId: STOREFRONT_DOMAIN, slug: 'minhaloja', title: '  Minha Loja  ', subtitle: '',
    colorPrimary: '#ff0000', colorBackground: '#F5F5F5', colorCard: '#FFFFFF', categories: ['electronics'], ...over,
  });
  const save = (over: Partial<SaveStorefrontDTO> = {}) => new SaveStorefrontUseCase(deps).execute(dto(over));

  it('sem plano → PLAN_FEATURE_UNAVAILABLE, nada gravado', async () => {
    lockPlan();
    await expect(save()).rejects.toBeInstanceOf(PlanFeatureUnavailableError);
    expect(fakes.storefronts.pages).toHaveLength(0);
  });

  it('config inválida → VALIDATION_ERROR com o campo', async () => {
    await expect(save({ colorCard: 'red' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', meta: { field: 'colorCard' } });
    await expect(save({ categories: ['nao_existe'] })).rejects.toBeInstanceOf(ValidationError);
    expect(fakes.storefronts.pages).toHaveLength(0);
  });

  it('domínio inativo → LINK_DOMAIN_INVALID', async () => {
    fakes.domains.items[0].status = LinkDomainStatus.PAUSED;
    await expect(save()).rejects.toBeInstanceOf(LinkDomainInvalidError);
  });

  it('cria: página normalizada + claim STOREFRONT na mesma transação', async () => {
    const out = await save({ slug: 'Nova-Loja' });
    expect(out).toMatchObject({
      title: 'Minha Loja', subtitle: null, colorPrimary: '#FF0000', categories: ['electronics'],
      address: { domainId: STOREFRONT_DOMAIN, slug: 'nova-loja' },
    });
    expect(fakes.storefronts.txCalls).toBe(1);
    expect(fakes.slugs.storefronts).toEqual([{ tenantId: TENANT, domainId: STOREFRONT_DOMAIN, slug: 'nova-loja', ownerId: out.id }]);
  });

  it('nunca grava status (plano decide)', async () => {
    const page = seedPageWithClaim(fakes, { status: 'PAUSED_BY_PLAN' as never });
    const out = await save({ status: 'ACTIVE' } as never);
    expect(out.status).toBe(page.status);
    expect(fakes.storefronts.pages[0].status).toBe('PAUSED_BY_PLAN');
  });

  it('atualiza sem trocar o nome: sem move, sem reserva', async () => {
    seedPageWithClaim(fakes);
    const out = await save({ title: 'Outro Nome' });
    expect(out.title).toBe('Outro Nome');
    expect(fakes.rotations.reservations).toEqual([]);
    expect(fakes.slugs.storefronts[0].slug).toBe('minhaloja');
  });

  it('atualiza trocando o nome: move o claim e reserva o antigo por 30 dias', async () => {
    seedPageWithClaim(fakes);
    const out = await save({ slug: 'lojanova' });
    expect(out.address).toEqual({ domainId: STOREFRONT_DOMAIN, slug: 'lojanova' });
    expect(fakes.slugs.storefronts[0].slug).toBe('lojanova');
    expect(fakes.rotations.reservations).toEqual([
      { domainId: STOREFRONT_DOMAIN, slug: 'minhaloja', tenantId: TENANT, expiresAt: new Date(NOW.getTime() + 30 * 86_400_000) },
    ]);
  });

  it('remover categoria da página limpa a categoria das ofertas', async () => {
    seedPageWithClaim(fakes, { categories: ['electronics', 'pet_shop'] });
    const kept = fakes.offers.seed({ category: 'electronics' });
    const orphan = fakes.offers.seed({ category: 'pet_shop' });
    await save({ categories: ['electronics'] });
    expect(fakes.offers.offers.find((o) => o.id === kept.id)?.category).toBe('electronics');
    expect(fakes.offers.offers.find((o) => o.id === orphan.id)?.category).toBeNull();
  });

  it('nome inválido → LINK_SLUG_INVALID', async () => {
    await expect(save({ slug: '!!' })).rejects.toBeInstanceOf(LinkSlugInvalidError);
  });

  it('nome reservado pelo domínio → LINK_SLUG_RESERVED', async () => {
    fakes.domains.items[0].reservedNames = ['vip'];
    await expect(save({ slug: 'vip' })).rejects.toBeInstanceOf(LinkSlugReservedError);
  });

  it('nome de outro tenant → LINK_SLUG_TAKEN com sugestões, nada gravado', async () => {
    fakes.slugs.storefronts.push({ tenantId: OTHER_TENANT, domainId: STOREFRONT_DOMAIN, slug: 'alheia', ownerId: 'sf-x' });
    const err = await save({ slug: 'alheia' }).catch((e) => e);
    expect(err).toBeInstanceOf(LinkSlugTakenError);
    expect((err as LinkSlugTakenError).meta?.suggestions).not.toEqual([]);
    expect(fakes.storefronts.pages).toHaveLength(0);
  });

  it('nome de rodízio do próprio tenant → LINK_SLUG_TAKEN', async () => {
    await addRotation('meulink');
    await expect(save({ slug: 'meulink' })).rejects.toBeInstanceOf(LinkSlugTakenError);
  });

  it('nome especial sem concessão → STOREFRONT_SLUG_PREMIUM', async () => {
    fakes.domains.items[0].premiumNames = ['ofertas'];
    await expect(save({ slug: 'ofertas' })).rejects.toBeInstanceOf(StorefrontSlugPremiumError);
  });

  it('nome especial com concessão vigente → cria', async () => {
    fakes.domains.items[0].premiumNames = ['ofertas'];
    fakes.slugs.grants.push({ domainId: STOREFRONT_DOMAIN, slug: 'ofertas', tenantId: TENANT, expiresAt: null });
    expect((await save({ slug: 'ofertas' })).address?.slug).toBe('ofertas');
  });

  it('corrida no unique dentro da tx → desfaz e LINK_SLUG_TAKEN com sugestões', async () => {
    const claim = fakes.slugs.claim.bind(fakes.slugs);
    fakes.slugs.claim = async (input) => {
      fakes.slugs.storefronts.push({ tenantId: OTHER_TENANT, domainId: input.domainId, slug: input.slug, ownerId: 'sf-x' });
      return claim(input);
    };
    const err = await save({ slug: 'corrida' }).catch((e) => e);
    expect(err).toBeInstanceOf(LinkSlugTakenError);
    expect((err as LinkSlugTakenError).meta?.suggestions).not.toEqual([]);
    expect(fakes.storefronts.pages).toHaveLength(0);
  });

  it('concessão premium expirou durante a tx (registry lança RESERVED) → STOREFRONT_SLUG_PREMIUM', async () => {
    fakes.domains.items[0].premiumNames = ['ofertas'];
    fakes.slugs.grants.push({ domainId: STOREFRONT_DOMAIN, slug: 'ofertas', tenantId: TENANT, expiresAt: null });
    const claim = fakes.slugs.claim.bind(fakes.slugs);
    fakes.slugs.claim = async (input) => { fakes.slugs.grants = []; return claim(input); };
    await expect(save({ slug: 'ofertas' })).rejects.toBeInstanceOf(StorefrontSlugPremiumError);
    expect(fakes.storefronts.pages).toHaveLength(0);
  });

  it('salvar de novo com o nome da própria página (OWNED) não é TAKEN', async () => {
    const page = seedPageWithClaim(fakes);
    await expect(save()).resolves.toMatchObject({ id: page.id });
  });
});
