import { describe, expect, it } from 'vitest';
import type { StorefrontOffer as PrismaStorefrontOffer } from '@prisma/client';
import { PrismaStorefrontOfferMapper } from './PrismaStorefrontOfferMapper';
import { StorefrontOfferStatus } from '../../domain/enums/StorefrontEnums';

const NOW = new Date('2026-10-29T12:00:00.000Z');

function row(overrides?: Partial<PrismaStorefrontOffer>): PrismaStorefrontOffer {
  return {
    id: 'o1', tenantId: 't1', storefrontId: 's1', status: 'PUBLISHED', position: 3, provider: 'SHOPEE',
    sourceUrl: 'https://s.shopee.com.br/x', affiliateUrl: 'https://s.shopee.com.br/y', attributionVerified: true,
    title: 'Fone', priceCents: 9990, originalPriceCents: 14990, imageUrl: '/m/o1.webp', category: 'eletronicos',
    publishedAt: NOW, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

describe('PrismaStorefrontOfferMapper', () => {
  it('mapeia todos os campos', () => {
    const d = PrismaStorefrontOfferMapper.toDomain(row());
    expect(d).toEqual({ ...row(), status: StorefrontOfferStatus.PUBLISHED });
  });

  it('nulos preservados (rascunho sem preço/imagem/categoria)', () => {
    const d = PrismaStorefrontOfferMapper.toDomain(row({
      status: 'DRAFT', priceCents: null, originalPriceCents: null, imageUrl: null, category: null,
      publishedAt: null, attributionVerified: false,
    }));
    expect(d).toMatchObject({
      status: StorefrontOfferStatus.DRAFT, priceCents: null, originalPriceCents: null, imageUrl: null,
      category: null, publishedAt: null, attributionVerified: false,
    });
  });

  it('não carrega campo extra de relation incluída', () => {
    const raw = { ...row(), storefront: { id: 's1' } } as PrismaStorefrontOffer;
    expect(PrismaStorefrontOfferMapper.toDomain(raw)).not.toHaveProperty('storefront');
  });
});
