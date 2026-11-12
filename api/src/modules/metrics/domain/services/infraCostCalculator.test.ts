import { describe, expect, it } from 'vitest';
import type { WorkerCapacityPlanRow } from '../../../sessions/domain/contracts/IWorkerCapacityReader';
import type { ResolvedFxRate } from './fxRate';
import { calculateInfraCosts, effectiveContractedSessions, type InfraCostCalculationInput } from './infraCostCalculator';
import { defaultInfraCostSettings, type InfraCostSettings } from './infraCostSettings';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const FX: ResolvedFxRate = { rate: 5.5, referenceDate: '2026-11-10', source: 'override', fetchedAt: null, stale: false };
const ch = (whatsapp = 0, telegram = 0) => ({ whatsapp, telegram });
const row = (planSlug: string | null, extra: Partial<WorkerCapacityPlanRow> = {}): WorkerCapacityPlanRow => ({
  planSlug, tenants: 1, contracted: ch(), unlimitedTenants: ch(), created: ch(), connected: ch(), ...extra,
});

function calc(over: Partial<InfraCostCalculationInput> = {}, settings: InfraCostSettings = defaultInfraCostSettings()) {
  return calculateInfraCosts({
    settings,
    fx: FX,
    live: { sessionsConnected: null, workerInstances: null, sessionsSampledAt: null },
    now: NOW,
    capacityByPlan: [],
    scaling: { maxSessionsPerWorker: 40, alertOccupancyRatio: 0.8 },
    ...over,
  });
}
const itemOf = (r: ReturnType<typeof calc>, key: string) => r.items.find((i) => i.key === key)!;

describe('calculateInfraCosts — totais (valores reais)', () => {
  it('120,25 com 1 worker (manual), em USD e BRL', () => {
    const r = calc();
    expect(r.basis).toBe('snapshot');
    expect(r.totals.total).toEqual({ usd: 120.25, brl: 661.375 });
    expect(r.totals.projected).toBeNull();
    expect(r.totalIsPartial).toBe(false);
    expect(itemOf(r, 'worker')).toMatchObject({ quantity: 1, quantitySource: 'manual', estimated: true });
    expect(itemOf(r, 'api').cost?.usd).toBe(28.75);
    expect(itemOf(r, 'postgres')).toMatchObject({ compute: { usd: 19 }, storage: { usd: 4.5 }, cost: { usd: 23.5 } });
    // fixo = itens fixed + armazenamento; variável = per_instance + usage + excedente
    expect(r.totals.fixed.usd).toBe(70.25);
    expect(r.totals.variable.usd).toBe(50);
    expect(r.totals.shared.usd).toBe(120.25);
  });

  it('145,25 com 2 instâncias nas amostras', () => {
    const r = calc({ live: { sessionsConnected: null, workerInstances: 2, sessionsSampledAt: null } });
    expect(r.totals.total.usd).toBe(145.25);
    expect(itemOf(r, 'worker')).toMatchObject({ quantity: 2, quantitySource: 'measured_now', estimated: false, compute: { usd: 50 } });
  });

  it('sem cotação: só USD e aviso fx_missing', () => {
    const r = calc({ fx: null });
    expect(r.totals.total).toEqual({ usd: 120.25, brl: null });
    expect(r.warnings).toContainEqual({ code: 'fx_missing' });
  });

  it('item excluído conta no total, fora do rateio', () => {
    const s = defaultInfraCostSettings();
    s.items.find((i) => i.key === 'email')!.allocation = 'excluded';
    const r = calc({}, s);
    expect(r.totals.total.usd).toBe(120.25);
    expect(r.totals.shared.usd).toBe(97.25);
  });
});

describe('workspace (excedente manual)', () => {
  it('banda 7 GB → 2 × 0,15 = 0,30; build 800 min → 1,50; entra no total e no compartilhado', () => {
    const s = defaultInfraCostSettings();
    s.workspace.manualBandwidthGb = 7;
    s.workspace.manualBuildMinutes = 800;
    const r = calc({}, s);
    expect(r.workspace.bandwidth).toEqual({ included: 5, consumed: 7, source: 'manual', overage: 2, cost: { usd: 0.3, brl: 1.65 } });
    expect(r.workspace.build).toMatchObject({ overage: 300, cost: { usd: 1.5 } });
    expect(r.workspace).toMatchObject({ planLabel: 'Hobby', total: { usd: 1.8 } });
    expect(r.totals.total.usd).toBe(122.05);
    expect(r.totals.shared.usd).toBe(122.05);
    expect(r.totals.variable.usd).toBe(51.8);
  });

  it('abaixo do incluso = 0; sem manual = sem consumo e excedente 0', () => {
    const s = defaultInfraCostSettings();
    s.workspace.manualBandwidthGb = 3;
    const r = calc({}, s);
    expect(r.workspace.bandwidth).toMatchObject({ overage: 0, cost: { usd: 0 } });
    expect(r.workspace.build).toEqual({ included: 500, consumed: null, source: null, overage: 0, cost: { usd: 0, brl: 0 } });
  });
});

describe('rateio por sessão (COST-05)', () => {
  const rows = [
    row('COPYSYNC_LITE', { tenants: 3, contracted: ch(3), connected: ch(2) }),
    row('COPYSYNC_MAX', { tenants: 1, unlimitedTenants: ch(1, 1), connected: ch(1, 1) }),
    row('COPYSYNC_PRO', { tenants: 0 }),
    row(null, { tenants: 1, unlimitedTenants: ch(1) }),
  ];

  it('tenant ilimitado pelo preset de cada canal; sem plano = 1', () => {
    expect(effectiveContractedSessions(rows[1])).toBe(4); // MAX: WhatsApp 2 + Telegram 2
    expect(effectiveContractedSessions(row('COPYSYNC_PRO', { unlimitedTenants: ch(1, 1) }))).toBe(2);
    expect(effectiveContractedSessions(row('COPYSYNC_LITE', { contracted: ch(1), unlimitedTenants: ch(0, 1) }))).toBe(1); // Telegram 0 no LITE
    expect(effectiveContractedSessions(rows[3])).toBe(1);
  });

  it('contratadas: custo por sessão, parte do plano, tenant médio; tenants 0 → null', () => {
    const r = calc({ capacityByPlan: rows });
    expect(r.perSession.contracted).toEqual({ sessions: 8, perSession: { usd: 15.0313, brl: 82.6719 }, unlimitedTenants: 3 });
    const lite = r.plans.find((p) => p.planSlug === 'COPYSYNC_LITE')!;
    expect(lite).toMatchObject({ contractedSessions: 3, share: { usd: 45.0938, brl: 248.0156 }, costPerTenant: { usd: 15.0313, brl: 82.6719 } });
    expect(r.plans.find((p) => p.planSlug === 'COPYSYNC_MAX')!).toMatchObject({ contractedSessions: 4, share: { usd: 60.125 } });
    const pro = r.plans.find((p) => p.planSlug === 'COPYSYNC_PRO')!;
    expect(pro).toMatchObject({ contractedSessions: 0, share: { usd: 0, brl: 0 }, costPerTenant: null });
    expect(r.warnings).toContainEqual({ code: 'unlimited_contracted', count: 3 });
  });

  it('conectadas e não alocadas (suspenso/cancelado) à parte', () => {
    const r = calc({ capacityByPlan: rows, live: { sessionsConnected: 6, workerInstances: null, sessionsSampledAt: minutesAgo(10) } });
    expect(r.perSession.connected).toEqual({
      sessions: 4, perSession: { usd: 30.0625, brl: 165.3438 }, unallocatedSessions: 2, unallocatedCost: { usd: 60.125, brl: 330.6875 },
    });
    expect(r.sessionsSampledAt).toEqual(minutesAgo(10));
    expect(r.warnings.some((w) => w.code === 'sessions_sample_stale')).toBe(false);
    expect(r.plans.find((p) => p.planSlug === 'COPYSYNC_MAX')!).toMatchObject({ connectedSessions: 2, connectedShare: { usd: 60.125 }, connectedCostPerTenant: { usd: 60.125 } });
  });

  it('amostra de sessões com mais de 10 min: não alocadas null + aviso, rateio por conectadas mantido', () => {
    const r = calc({ capacityByPlan: rows, live: { sessionsConnected: 6, workerInstances: null, sessionsSampledAt: new Date(minutesAgo(10).getTime() - 1) } });
    expect(r.perSession.connected).toEqual({ sessions: 4, perSession: { usd: 30.0625, brl: 165.3438 }, unallocatedSessions: null, unallocatedCost: null });
    expect(r.warnings).toContainEqual({ code: 'sessions_sample_stale' });
  });

  it('sem sessão e sem amostra: null em toda divisão', () => {
    const r = calc({ capacityByPlan: [row('COPYSYNC_LITE', { tenants: 0 })] });
    expect(r.perSession.contracted).toEqual({ sessions: 0, perSession: null, unlimitedTenants: 0 });
    expect(r.perSession.connected).toEqual({ sessions: 0, perSession: null, unallocatedSessions: null, unallocatedCost: null });
    expect(r.plans[0]).toMatchObject({ share: null, costPerTenant: null, connectedShare: null, connectedCostPerTenant: null });
    expect(r.warnings.some((w) => w.code === 'unlimited_contracted')).toBe(false);
  });

  it('marginal = 25 ÷ (teto × ratio)', () => {
    expect(calc().marginalPerSession).toEqual({ usd: 0.7813, brl: 4.2969 });
    expect(calc({ scaling: { maxSessionsPerWorker: 50, alertOccupancyRatio: 0.5 } }).marginalPerSession?.usd).toBe(1);
  });

  it('sem item worker → marginal null', () => {
    const s = defaultInfraCostSettings();
    s.items = s.items.filter((i) => i.renderKey !== 'worker');
    expect(calc({}, s).marginalPerSession).toBeNull();
  });
});

describe('itens sem preço, armazenamento e leitura da Render', () => {
  it('plano lido sem preço → item null, total parcial e aviso', () => {
    const r = calc({ resources: [{ renderKey: 'api', plan: '4c-16g', instances: 1, diskGb: null, suspended: false }] });
    expect(itemOf(r, 'api')).toMatchObject({ plan: '4c-16g', compute: null, cost: null, neighbors: null });
    expect(r.totalIsPartial).toBe(true);
    expect(r.totals.total.usd).toBe(91.5);
    expect(r.warnings).toContainEqual({ code: 'plan_without_price', resourceKey: 'api', plan: '4c-16g' });
  });

  it('plano lido com preço, disco lido vence o cadastrado, suspenso = 0', () => {
    const r = calc({
      resources: [
        { renderKey: 'postgres', plan: '1c-2g', instances: 1, diskGb: 20, suspended: false },
        { renderKey: 'redis', plan: '1gb', instances: 1, diskGb: null, suspended: true },
      ],
    });
    expect(itemOf(r, 'postgres')).toMatchObject({ compute: { usd: 40 }, storage: { usd: 6 }, cost: { usd: 46 } });
    expect(itemOf(r, 'redis').compute?.usd).toBe(0);
  });

  it('storage a confirmar → soma só a computação, sem total parcial', () => {
    const s = defaultInfraCostSettings();
    s.items.find((i) => i.key === 'api')!.storage = { gb: null, usdPerGb: 0.25 };
    s.items.find((i) => i.key === 'postgres')!.storage = { gb: 15, usdPerGb: null };
    const r = calc({}, s);
    expect(itemOf(r, 'api')).toMatchObject({ storage: null, storageToConfirm: true, cost: { usd: 25 } });
    expect(r.totals.total.usd).toBe(112);
    expect(r.totalIsPartial).toBe(false);
    expect(r.warnings.filter((w) => w.code === 'storage_to_confirm')).toEqual([
      { code: 'storage_to_confirm', key: 'api' },
      { code: 'storage_to_confirm', key: 'postgres' },
    ]);
  });
});

describe('plano vizinho (COST-02a)', () => {
  it('api 25 → 7 e 85, com diferença', () => {
    expect(itemOf(calc(), 'api').neighbors).toEqual({
      lower: { plan: '0.5c-512mb', monthly: { usd: 7, brl: 38.5 }, diff: { usd: -18, brl: -99 } },
      upper: { plan: '2c-4g', monthly: { usd: 85, brl: 467.5 }, diff: { usd: 60, brl: 330 } },
    });
  });

  it('pontas = null; static e item sem renderKey sem vizinho', () => {
    const s = defaultInfraCostSettings();
    s.items.find((i) => i.key === 'worker')!.monthlyUsd = 135;
    const r = calc({}, s);
    expect(itemOf(r, 'worker').neighbors).toMatchObject({ lower: { plan: '2c-4g' }, upper: null });
    expect(itemOf(r, 'redis').neighbors).toEqual({ lower: null, upper: null });
    expect(itemOf(r, 'static').neighbors).toBeNull();
    expect(itemOf(r, 'email').neighbors).toBeNull();
  });
});
