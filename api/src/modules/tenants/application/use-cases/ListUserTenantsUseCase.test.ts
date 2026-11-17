import { describe, expect, it, vi } from 'vitest';
import { ListUserTenantsUseCase } from './ListUserTenantsUseCase';
import { TenantPresenter } from '../../presentation/presenters/TenantPresenter';
import type { ProductKey } from '../../domain/services/resolveProductAccess';

const membership = (tenantId: string) => ({ tenantId, tenantName: `Loja ${tenantId}`, tenantSlug: tenantId, tenantStatus: 'ACTIVE', role: 'ADMIN' });

describe('ListUserTenantsUseCase', () => {
  it('acrescenta products por tenant, uma leitura por tenant', async () => {
    const list = vi.fn(async (tenantId: string): Promise<ProductKey[]> => (tenantId === 't2' ? ['SAVER'] : ['AFFILIATES', 'CHAT']));
    const uc = new ListUserTenantsUseCase({ findTenantsForUser: async () => [membership('t1'), membership('t2')] }, () => ({ list }));
    const { tenants } = await uc.execute({ userId: 'u1' });
    expect(tenants.map((t) => t.products)).toEqual([['AFFILIATES', 'CHAT'], ['SAVER']]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(TenantPresenter.toTenantItem(tenants[0])).toEqual({
      id: 't1', name: 'Loja t1', slug: 't1', status: 'ACTIVE', role: 'ADMIN', products: ['AFFILIATES', 'CHAT'],
    });
  });

  it('falha de leitura sobe', async () => {
    const uc = new ListUserTenantsUseCase({ findTenantsForUser: async () => [membership('t1')] }, () => ({ list: async () => { throw new Error('db'); } }));
    await expect(uc.execute({ userId: 'u1' })).rejects.toThrow('db');
  });

  it('sem tenant não lê produtos', async () => {
    const list = vi.fn();
    const uc = new ListUserTenantsUseCase({ findTenantsForUser: async () => [] }, () => ({ list }));
    expect((await uc.execute({ userId: 'u1' })).tenants).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });
});
