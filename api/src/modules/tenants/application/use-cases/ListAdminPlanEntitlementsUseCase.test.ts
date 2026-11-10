import { describe, expect, it, vi } from 'vitest';
import { ListAdminPlanEntitlementsUseCase } from './ListAdminPlanEntitlementsUseCase';
import { ADMIN_EDITABLE_ENTITLEMENT_KEYS } from '../../domain/adminEditableEntitlements';
import type { IPlanEntitlementPresetRepository } from '../../domain/contracts/IPlanEntitlementPresetRepository';

function fakeRepo(rows: Awaited<ReturnType<IPlanEntitlementPresetRepository['listByKeys']>>) {
  return { listByKeys: vi.fn(async () => rows), setForPlan: vi.fn() } satisfies IPlanEntitlementPresetRepository;
}

describe('ListAdminPlanEntitlementsUseCase', () => {
  it('consulta só a allowlist e devolve chave × plano; sem preset = null', async () => {
    const repo = fakeRepo([
      { planSlug: 'COPYSYNC_MAX', key: 'marketplace_shein_enabled', value: true },
      { planSlug: 'COPYSYNC_LITE', key: 'marketplace_shein_enabled', value: false },
      { planSlug: 'LEGACY', key: 'marketplace_shein_enabled', value: true },
    ]);
    const out = await new ListAdminPlanEntitlementsUseCase(repo).execute();
    expect(repo.listByKeys).toHaveBeenCalledWith(ADMIN_EDITABLE_ENTITLEMENT_KEYS);
    expect(out).toEqual([
      { key: 'marketplace_shein_enabled', plans: { COPYSYNC_LITE: false, COPYSYNC_PRO: null, COPYSYNC_MAX: true } },
    ]);
  });

  it('banco sem presets: todas as chaves com null em todos os planos', async () => {
    const out = await new ListAdminPlanEntitlementsUseCase(fakeRepo([])).execute();
    expect(out).toHaveLength(ADMIN_EDITABLE_ENTITLEMENT_KEYS.length);
    expect(out[0].plans).toEqual({ COPYSYNC_LITE: null, COPYSYNC_PRO: null, COPYSYNC_MAX: null });
  });
});
