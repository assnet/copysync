import { describe, expect, it } from 'vitest';
import { PrismaStorefrontMapper, type PrismaStorefrontWithClaim } from './PrismaStorefrontMapper';
import { StorefrontStatus } from '../../domain/enums/StorefrontEnums';

const NOW = new Date('2026-10-29T12:00:00.000Z');

function row(overrides?: Partial<PrismaStorefrontWithClaim>): PrismaStorefrontWithClaim {
  return {
    id: 's1', tenantId: 't1', title: 'Ofertas da Ana', subtitle: null, avatarUrl: null, coverUrl: null,
    colorPrimary: '#2563EB', colorBackground: '#F5F5F5', colorCard: '#FFFFFF', categories: ['eletronicos', 'casa'],
    status: 'ACTIVE', createdAt: NOW, updatedAt: NOW, claim: { domainId: 'd1', slug: 'ana' },
    ...overrides,
  };
}

describe('PrismaStorefrontMapper', () => {
  it('endereço vem do claim', () => {
    const d = PrismaStorefrontMapper.toDomain(row());
    expect(d.address).toEqual({ domainId: 'd1', slug: 'ana' });
    expect(d.status).toBe(StorefrontStatus.ACTIVE);
    expect(d.categories).toEqual(['eletronicos', 'casa']);
  });

  it('sem claim: address null', () => {
    expect(PrismaStorefrontMapper.toDomain(row({ claim: null })).address).toBeNull();
  });

  it('não vaza o objeto do claim nem campos fora do domínio', () => {
    const d = PrismaStorefrontMapper.toDomain(row({ status: 'PAUSED_BY_PLAN' }));
    expect(d).not.toHaveProperty('claim');
    expect(d.status).toBe(StorefrontStatus.PAUSED_BY_PLAN);
    expect(Object.keys(d).sort()).toEqual([
      'address', 'avatarUrl', 'categories', 'colorBackground', 'colorCard', 'colorPrimary', 'coverUrl',
      'createdAt', 'id', 'status', 'subtitle', 'tenantId', 'title', 'updatedAt',
    ]);
  });

  it('categorias são cópia (mutar o domínio não muda a linha)', () => {
    const r = row();
    PrismaStorefrontMapper.toDomain(r).categories.push('x');
    expect(r.categories).toEqual(['eletronicos', 'casa']);
  });
});
