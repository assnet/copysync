import { describe, expect, it } from 'vitest';
import { ApplyPlanToStorefrontUseCase } from './ApplyPlanToStorefrontUseCase';
import { FakeEntitlementReader, InMemoryStorefrontRepository, OTHER_TENANT, TENANT } from './storefrontTestFakes';
import { StorefrontStatus } from '../../domain/enums/StorefrontEnums';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';

function setup(enabled: unknown, status = StorefrontStatus.ACTIVE) {
  const storefronts = new InMemoryStorefrontRepository();
  storefronts.seed({ status });
  storefronts.seed({ id: 'sf-other', tenantId: OTHER_TENANT, status: StorefrontStatus.ACTIVE });
  const entitlements = new FakeEntitlementReader(enabled === undefined ? {} : { [ENTITLEMENT_KEYS.STOREFRONT_ENABLED]: enabled });
  return { storefronts, uc: new ApplyPlanToStorefrontUseCase(storefronts, entitlements) };
}

describe('ApplyPlanToStorefrontUseCase', () => {
  it('plano sem a vitrine pausa a página e não toca outro tenant', async () => {
    const { storefronts, uc } = setup(false);
    expect(await uc.execute(TENANT)).toBe(StorefrontStatus.PAUSED_BY_PLAN);
    expect(storefronts.pages.map((p) => p.status)).toEqual([StorefrontStatus.PAUSED_BY_PLAN, StorefrontStatus.ACTIVE]);
  });

  it('entitlement ausente ou inválido também pausa', async () => {
    expect(await setup(undefined).uc.execute(TENANT)).toBe(StorefrontStatus.PAUSED_BY_PLAN);
    expect(await setup('sim').uc.execute(TENANT)).toBe(StorefrontStatus.PAUSED_BY_PLAN);
  });

  it('plano com a vitrine reativa página pausada', async () => {
    const { storefronts, uc } = setup(true, StorefrontStatus.PAUSED_BY_PLAN);
    expect(await uc.execute(TENANT)).toBe(StorefrontStatus.ACTIVE);
    expect(storefronts.pages[0].status).toBe(StorefrontStatus.ACTIVE);
  });

  it('tenant sem página: nada a fazer', async () => {
    const { uc } = setup(true);
    expect(await uc.execute('tenant-sem-pagina')).toBeNull();
  });
});
