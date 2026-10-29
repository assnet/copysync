import { describe, it, expect, beforeEach } from 'vitest';
import { UpdateStorefrontOfferUseCase } from './UpdateStorefrontOfferUseCase';
import { SetStorefrontOfferStatusUseCase } from './SetStorefrontOfferStatusUseCase';
import { ReorderStorefrontOffersUseCase } from './ReorderStorefrontOffersUseCase';
import { DeleteStorefrontOfferUseCase } from './DeleteStorefrontOfferUseCase';
import { makeStorefrontDeps, NOW, OTHER_TENANT, TENANT, type StorefrontFakes } from './storefrontTestFakes';
import type { StorefrontUseCaseDeps } from './storefrontUseCaseDeps';
import { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';

const { DRAFT, PUBLISHED } = StorefrontOfferStatus;

let fakes: StorefrontFakes;
let deps: Required<StorefrontUseCaseDeps>;

beforeEach(() => {
  ({ deps, fakes } = makeStorefrontDeps());
  fakes.storefronts.seed();
});

describe('UpdateStorefrontOfferUseCase', () => {
  it('atualiza título (aparado), preços e categoria da página', async () => {
    const o = fakes.offers.seed();
    const out = await new UpdateStorefrontOfferUseCase(deps).execute({
      tenantId: TENANT, id: o.id, title: '  Novo título  ', priceCents: 500, originalPriceCents: null, category: 'pet_shop',
    });
    expect(out).toMatchObject({ title: 'Novo título', priceCents: 500, originalPriceCents: null, category: 'pet_shop' });
  });

  it('campo ausente não muda', async () => {
    const o = fakes.offers.seed({ title: 'Antigo', category: 'electronics' });
    const out = await new UpdateStorefrontOfferUseCase(deps).execute({ tenantId: TENANT, id: o.id, priceCents: 1 });
    expect(out).toMatchObject({ title: 'Antigo', category: 'electronics', priceCents: 1 });
  });

  it('categoria fora da página vira "Sem categoria"', async () => {
    const o = fakes.offers.seed({ category: 'electronics' });
    const out = await new UpdateStorefrontOfferUseCase(deps).execute({ tenantId: TENANT, id: o.id, category: 'automotive' });
    expect(out.category).toBeNull();
  });

  it.each([
    [{ title: '' }],
    [{ title: 'a'.repeat(141) }],
    [{ priceCents: -1 }],
    [{ originalPriceCents: 1.5 }],
  ])('campo inválido %o responde VALIDATION_ERROR', async (patch) => {
    const o = fakes.offers.seed();
    await expect(new UpdateStorefrontOfferUseCase(deps).execute({ tenantId: TENANT, id: o.id, ...patch }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('oferta de outro tenant responde STOREFRONT_NOT_FOUND', async () => {
    const o = fakes.offers.seed({ tenantId: OTHER_TENANT });
    await expect(new UpdateStorefrontOfferUseCase(deps).execute({ tenantId: TENANT, id: o.id, title: 'x' }))
      .rejects.toMatchObject({ code: 'STOREFRONT_NOT_FOUND' });
  });
});

describe('SetStorefrontOfferStatusUseCase', () => {
  it('publicar leva para o fim das publicadas e grava publishedAt', async () => {
    fakes.offers.seed({ status: PUBLISHED, position: 3 });
    const o = fakes.offers.seed({ position: 0 });
    const out = await new SetStorefrontOfferStatusUseCase(deps).execute({ tenantId: TENANT, id: o.id, status: PUBLISHED });
    expect(out).toMatchObject({ status: PUBLISHED, position: 4, publishedAt: NOW });
  });

  it('despublicar volta para o fim dos rascunhos e limpa publishedAt', async () => {
    const o = fakes.offers.seed({ status: PUBLISHED, publishedAt: NOW });
    const out = await new SetStorefrontOfferStatusUseCase(deps).execute({ tenantId: TENANT, id: o.id, status: DRAFT });
    expect(out).toMatchObject({ status: DRAFT, position: 0, publishedAt: null });
  });

  it('com 60 publicadas responde STOREFRONT_PUBLISHED_LIMIT', async () => {
    for (let i = 0; i < 60; i++) fakes.offers.seed({ status: PUBLISHED, position: i });
    const o = fakes.offers.seed();
    await expect(new SetStorefrontOfferStatusUseCase(deps).execute({ tenantId: TENANT, id: o.id, status: PUBLISHED }))
      .rejects.toMatchObject({ code: 'STOREFRONT_PUBLISHED_LIMIT', meta: { limit: 60 } });
  });

  it('mesmo status não muda nada (republicar no limite não falha)', async () => {
    for (let i = 0; i < 60; i++) fakes.offers.seed({ status: PUBLISHED, position: i });
    const o = fakes.offers.offers[5]!;
    const out = await new SetStorefrontOfferStatusUseCase(deps).execute({ tenantId: TENANT, id: o.id, status: PUBLISHED });
    expect(out.position).toBe(5);
  });

  it('oferta de outro tenant responde STOREFRONT_NOT_FOUND', async () => {
    const o = fakes.offers.seed({ tenantId: OTHER_TENANT });
    await expect(new SetStorefrontOfferStatusUseCase(deps).execute({ tenantId: TENANT, id: o.id, status: PUBLISHED }))
      .rejects.toMatchObject({ code: 'STOREFRONT_NOT_FOUND' });
  });
});

describe('ReorderStorefrontOffersUseCase', () => {
  it('grava a nova ordem da aba', async () => {
    const a = fakes.offers.seed({ position: 0 });
    const b = fakes.offers.seed({ position: 1 });
    fakes.offers.seed({ status: PUBLISHED, position: 0 });
    await new ReorderStorefrontOffersUseCase(deps).execute({ tenantId: TENANT, status: DRAFT, ids: [b.id, a.id] });
    expect(await fakes.offers.listIdsByStatus(TENANT, 'sf-1', DRAFT)).toEqual([b.id, a.id]);
  });

  it.each([
    ['faltando', (ids: string[]) => ids.slice(1)],
    ['repetido', (ids: string[]) => [ids[0]!, ids[0]!]],
    ['estranho', (ids: string[]) => [ids[0]!, 'off-x']],
    ['de outra aba', (ids: string[]) => [...ids, 'off-3']],
  ])('id %s responde STOREFRONT_ORDER_INVALID', async (_name, mutate) => {
    const a = fakes.offers.seed({ position: 0 });
    const b = fakes.offers.seed({ position: 1 });
    fakes.offers.seed({ status: PUBLISHED });
    await expect(new ReorderStorefrontOffersUseCase(deps).execute({ tenantId: TENANT, status: DRAFT, ids: mutate([a.id, b.id]) }))
      .rejects.toMatchObject({ code: 'STOREFRONT_ORDER_INVALID' });
  });

  it('sem página responde STOREFRONT_NOT_FOUND', async () => {
    fakes.storefronts.pages = [];
    await expect(new ReorderStorefrontOffersUseCase(deps).execute({ tenantId: TENANT, status: DRAFT, ids: [] }))
      .rejects.toMatchObject({ code: 'STOREFRONT_NOT_FOUND' });
  });
});

describe('DeleteStorefrontOfferUseCase', () => {
  it('apaga a oferta e a imagem dela', async () => {
    const o = fakes.offers.seed({ imageUrl: 'https://media.example/storefront-o.webp' });
    await new DeleteStorefrontOfferUseCase(deps).execute({ tenantId: TENANT, id: o.id });
    expect(fakes.offers.offers).toEqual([]);
    expect(fakes.media.removed).toEqual(['https://media.example/storefront-o.webp']);
  });

  it('sem imagem não chama o storage', async () => {
    const o = fakes.offers.seed();
    await new DeleteStorefrontOfferUseCase(deps).execute({ tenantId: TENANT, id: o.id });
    expect(fakes.media.removed).toEqual([]);
  });

  it('oferta de outro tenant responde STOREFRONT_NOT_FOUND e fica', async () => {
    const o = fakes.offers.seed({ tenantId: OTHER_TENANT, imageUrl: 'https://media.example/storefront-o.webp' });
    await expect(new DeleteStorefrontOfferUseCase(deps).execute({ tenantId: TENANT, id: o.id }))
      .rejects.toMatchObject({ code: 'STOREFRONT_NOT_FOUND' });
    expect(fakes.offers.offers).toHaveLength(1);
    expect(fakes.media.removed).toEqual([]);
  });
});

describe('gate de plano nas edições', () => {
  it.each([
    ['Update', () => new UpdateStorefrontOfferUseCase(deps).execute({ tenantId: TENANT, id: 'x', title: 'y' })],
    ['SetStatus', () => new SetStorefrontOfferStatusUseCase(deps).execute({ tenantId: TENANT, id: 'x', status: PUBLISHED })],
    ['Reorder', () => new ReorderStorefrontOffersUseCase(deps).execute({ tenantId: TENANT, status: DRAFT, ids: [] })],
    ['Delete', () => new DeleteStorefrontOfferUseCase(deps).execute({ tenantId: TENANT, id: 'x' })],
  ])('%s sem storefront_enabled responde PLAN_FEATURE_UNAVAILABLE', async (_name, run) => {
    fakes.entitlements.values = {};
    await expect(run()).rejects.toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE' });
  });

  it('rascunho sem título não é publicado', async () => {
    const o = fakes.offers.seed({ title: '' });
    await expect(new SetStorefrontOfferStatusUseCase(deps).execute({ tenantId: TENANT, id: o.id, status: PUBLISHED }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', meta: { field: 'title' } });
  });
});
