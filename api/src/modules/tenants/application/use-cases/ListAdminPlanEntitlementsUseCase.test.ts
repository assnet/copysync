import { describe, expect, it, vi } from 'vitest';
import { ListAdminPlanEntitlementsUseCase } from './ListAdminPlanEntitlementsUseCase';
import { ADMIN_EDITABLE_ENTITLEMENT_KEYS } from '../../domain/adminEditableEntitlements';
import type { IPlanEntitlementPresetRepository } from '../../domain/contracts/IPlanEntitlementPresetRepository';

const SAVER_NULL = { SAVER_LITE: null, SAVER_PRO: null, SAVER_MAX: null };
const AFFILIATES_OWNED = { product: 'AFFILIATES', editablePlans: ['COPYSYNC_LITE', 'COPYSYNC_PRO', 'COPYSYNC_MAX'] };

function fakeRepo(rows: Awaited<ReturnType<IPlanEntitlementPresetRepository['listByKeys']>>) {
  return { listByKeys: vi.fn(async () => rows), setForPlan: vi.fn() } satisfies IPlanEntitlementPresetRepository;
}

const STORES = { marketplace_kabum_enabled: true, marketplace_magalu_enabled: true, marketplace_aliexpress_enabled: true };
const audience = { all: async () => ({ offer_hunter_enabled: true, saver: true, ...STORES }) };

describe('ListAdminPlanEntitlementsUseCase', () => {
  it('consulta só a allowlist e devolve chave × plano; sem preset = null', async () => {
    const repo = fakeRepo([
      { planSlug: 'COPYSYNC_MAX', key: 'marketplace_shein_enabled', value: true },
      { planSlug: 'COPYSYNC_LITE', key: 'marketplace_shein_enabled', value: false },
      { planSlug: 'LEGACY', key: 'marketplace_shein_enabled', value: true },
    ]);
    const out = await new ListAdminPlanEntitlementsUseCase(repo, audience).execute();
    expect(repo.listByKeys).toHaveBeenCalledWith(ADMIN_EDITABLE_ENTITLEMENT_KEYS);
    expect(out[0]).toEqual({
      key: 'marketplace_shein_enabled',
      type: { kind: 'boolean' },
      plans: { COPYSYNC_LITE: false, COPYSYNC_PRO: null, COPYSYNC_MAX: true, ...SAVER_NULL },
      ...AFFILIATES_OWNED,
      superAdminOnly: null,
    });
    expect(out.map((r) => r.key)).toEqual([
      'marketplace_shein_enabled', 'marketplace_kabum_enabled', 'marketplace_magalu_enabled', 'marketplace_aliexpress_enabled',
      'offer_hunter_enabled', 'offer_hunter_finds_per_day', 'saver']);
  });

  it('chave numérica devolve tipo inteiro com faixa e o valor do preset', async () => {
    const repo = fakeRepo([{ planSlug: 'COPYSYNC_MAX', key: 'offer_hunter_finds_per_day', value: 10 }]);
    const out = await new ListAdminPlanEntitlementsUseCase(repo, audience).execute();
    expect(out.find((r) => r.key === 'offer_hunter_finds_per_day')).toEqual({
      key: 'offer_hunter_finds_per_day',
      type: { kind: 'integer', min: 0, max: 100 },
      plans: { COPYSYNC_LITE: null, COPYSYNC_PRO: null, COPYSYNC_MAX: 10, ...SAVER_NULL },
      ...AFFILIATES_OWNED,
      superAdminOnly: null,
    });
  });

  it('banco sem presets: todas as chaves com null em todos os planos', async () => {
    const out = await new ListAdminPlanEntitlementsUseCase(fakeRepo([]), audience).execute();
    expect(out).toHaveLength(ADMIN_EDITABLE_ENTITLEMENT_KEYS.length + 1);
    expect(out[0].plans).toEqual({ COPYSYNC_LITE: null, COPYSYNC_PRO: null, COPYSYNC_MAX: null, ...SAVER_NULL });
    // Lojas e Caçador são de Afiliados: nenhum plano Saver editável
    for (const row of out.filter((r) => r.type)) expect(row).toMatchObject(AFFILIATES_OWNED);
  });

  it('superAdminOnly só na chave com audiência (flag efetiva); demais null', async () => {
    const out = await new ListAdminPlanEntitlementsUseCase(fakeRepo([]), { all: async () => ({ offer_hunter_enabled: false, saver: true, ...STORES, marketplace_magalu_enabled: false }) }).execute();
    expect(Object.fromEntries(out.map((r) => [r.key, r.superAdminOnly]))).toEqual({
      marketplace_shein_enabled: null, marketplace_kabum_enabled: true, marketplace_magalu_enabled: false,
      marketplace_aliexpress_enabled: true, offer_hunter_enabled: false, offer_hunter_finds_per_day: null, saver: true,
    });
  });

  it('audiência fora da allowlist (Saver): linha só com a flag, plans vazio e sem type', async () => {
    const out = await new ListAdminPlanEntitlementsUseCase(fakeRepo([]), { all: async () => ({ offer_hunter_enabled: true, saver: false, ...STORES }) }).execute();
    const row = out.find((r) => r.key === 'saver');
    expect(row).toEqual({ key: 'saver', plans: {}, product: 'SAVER', editablePlans: [], superAdminOnly: false });
    expect(row).not.toHaveProperty('type');
  });
});
