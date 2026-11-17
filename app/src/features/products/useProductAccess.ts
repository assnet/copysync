import { useMemo } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { productsOfTenant, type ProductKey } from './productAccess';

export interface ProductAccess {
  /** `false` enquanto `GET /tenants` não respondeu: nunca presumir produto nesse intervalo. */
  loaded: boolean;
  products: ProductKey[];
}

/**
 * Produtos do tenant ativo, lidos do `TenantContext`. Tenant ativo fora da lista carregada
 * (ou lista que falhou) fica no legado: mesmo comportamento de hoje, a API segue barrando.
 */
export function useProductAccess(): ProductAccess {
  const { tenants, tenantsLoaded, activeTenantId } = useTenant();
  return useMemo(() => {
    if (!tenantsLoaded) return { loaded: false, products: [] };
    const active = tenants.find((t) => t.id === activeTenantId);
    return { loaded: true, products: productsOfTenant(active) };
  }, [tenants, tenantsLoaded, activeTenantId]);
}
