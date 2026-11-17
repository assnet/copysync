import { describe, expect, it } from 'vitest';
import type { TenantProduct } from '@prisma/client';
import { PrismaTenantProductMapper } from './PrismaTenantProductMapper';

const row = (over: Partial<TenantProduct> = {}): TenantProduct => ({
  id: 'id1', tenantId: 't1', product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_LITE', expiresAt: null,
  source: 'BILLING', inactiveSince: null, createdAt: new Date(0), updatedAt: new Date(1), ...over,
});

describe('PrismaTenantProductMapper', () => {
  it('mapeia linha conhecida', () => {
    expect(PrismaTenantProductMapper.toDomain(row())).toEqual({
      tenantId: 't1', product: 'SAVER', status: 'ACTIVE', planSlug: 'SAVER_LITE', expiresAt: null,
      source: 'BILLING', inactiveSince: null, updatedAt: new Date(1),
    });
  });

  it('produto desconhecido = null', () => {
    expect(PrismaTenantProductMapper.toDomain(row({ product: 'FUTURO' }))).toBeNull();
  });

  it('status inesperado nega (INACTIVE); source ADMIN preservado', () => {
    const m = PrismaTenantProductMapper.toDomain(row({ status: 'weird', source: 'ADMIN' }));
    expect(m?.status).toBe('INACTIVE');
    expect(m?.source).toBe('ADMIN');
  });
});
