import { describe, expect, it } from 'vitest';
import type { IPageViewReader, PageViewScope } from '../../domain/contracts/IPageViewReader';
import { UsageMetricsRangeInvalidError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import { FakeUsageReadGate, FakeUsageTenantDirectory, usageTenant } from './featureUsageTestFakes';
import { GetFeatureUsageScreensUseCase } from './GetFeatureUsageScreensUseCase';
import type { FeatureUsageQueryInput } from './GetFeatureUsageSummaryUseCase';

const NOW = new Date('2026-11-17T15:00:00.000Z');
const INPUT: FeatureUsageQueryInput = {
  from: '2026-10-19', to: '2026-11-17', granularity: 'day', kinds: ['ACTION'], tenantStatus: 'ACTIVE', includeInternal: false,
};

function setup() {
  const calls: { fromDay: string; toDayExclusive: string; scopes: readonly PageViewScope[] }[] = [];
  const pageViews: IPageViewReader = {
    read: async (input) => {
      calls.push(input);
      return { rows: [{ key: 'view:offers', tenants: 2, tenantDays: 9 }, { key: 'view:saver-groups', tenants: 1, tenantDays: 1 }], firstDataDay: '2026-11-19' };
    },
  };
  const directory = new FakeUsageTenantDirectory([
    usageTenant('t1', 'COPYSYNC_MAX'),
    usageTenant('t2', 'COPYSYNC_LITE', 'SAVER_PRO'),
    usageTenant('t3', 'NONE', 'SAVER_LITE', { internal: true }),
    usageTenant('t4', 'COPYSYNC_PRO', 'NONE', { status: 'SUSPENDED' }),
  ]);
  const gate = new FakeUsageReadGate();
  return { useCase: new GetFeatureUsageScreensUseCase({ pageViews, directory, gate, now: () => NOW }), calls, gate };
}

describe('GetFeatureUsageScreensUseCase', () => {
  it('uma linha por tela (zero sem visita), ordem por contas, sem conta na saída; uma vaga do portão', async () => {
    const { useCase, calls, gate } = setup();
    const out = await useCase.execute(INPUT);
    expect(gate.opened).toBe(1);
    expect(out.screens).toHaveLength(15);
    expect(out.screens[0]).toEqual({ key: 'view:offers', product: 'AFFILIATES', planFamily: 'AFFILIATES', tenants: 2, tenantDays: 9 });
    expect(out.screens.find((s) => s.key === 'view:dashboard')).toMatchObject({ tenants: 0, tenantDays: 0 });
    expect(out.firstDataDay).toBe('2026-11-19');
    expect(out.range).toMatchObject({ from: '2026-10-19', to: '2026-11-17', maxDays: 400 });
    expect(JSON.stringify(out)).not.toMatch(/"t[1-4]"/);
    // Recorte: ativas, sem internas; o filtro de tipo não vale para telas
    expect(calls[0]).toMatchObject({ fromDay: '2026-10-19', toDayExclusive: '2026-11-18' });
    expect(calls[0]!.scopes.map((s) => s.tenantIds)).toEqual([['t1', 't2'], ['t1', 't2']]);
    expect(out.population.tenants).toBe(2);
    expect(out.population.byFamily).toEqual([{ family: 'AFFILIATES', tenants: 2 }, { family: 'SAVER', tenants: 2 }]);
  });

  it('plano restringe contas e telas à família dele; produto restringe telas', async () => {
    const { useCase, calls } = setup();
    const saver = await useCase.execute({ ...INPUT, plan: 'SAVER_PRO' });
    expect(saver.screens.map((s) => s.key).sort()).toEqual(['view:saver-groups', 'view:saver-plans', 'view:saver-settings']);
    expect(calls[0]!.scopes).toEqual([{ keys: ['view:saver-groups', 'view:saver-settings', 'view:saver-plans'], tenantIds: ['t2'] }]);
    const access = await useCase.execute({ ...INPUT, product: 'ACCESS' });
    expect(access.screens.map((s) => s.key).sort()).toEqual(['view:dashboard', 'view:settings']);
  });

  it('plano NONE: cada família com as contas sem plano nela', async () => {
    const { useCase, calls } = setup();
    await useCase.execute({ ...INPUT, plan: 'NONE', includeInternal: true });
    expect(calls[0]!.scopes.map((s) => s.tenantIds)).toEqual([['t3'], ['t1']]);
  });

  it('população por família: com plano só a família dele; Saver divide pelas contas com plano Saver', async () => {
    const { useCase } = setup();
    const saver = await useCase.execute({ ...INPUT, plan: 'SAVER_PRO' });
    expect(saver.population).toEqual({ tenants: 1, byFamily: [{ family: 'SAVER', tenants: 1 }] });
  });

  it('período até 400 dias; acima ou no futuro = USAGE_METRICS_RANGE_INVALID', async () => {
    const { useCase } = setup();
    await expect(useCase.execute({ ...INPUT, from: '2025-10-14', granularity: 'week' })).resolves.toBeDefined();
    await expect(useCase.execute({ ...INPUT, to: '2026-11-18' })).rejects.toBeInstanceOf(UsageMetricsRangeInvalidError);
  });
});
