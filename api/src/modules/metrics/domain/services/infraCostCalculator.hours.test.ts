import { describe, expect, it } from 'vitest';
import type { ResolvedFxRate } from './fxRate';
import {
  allocateInfraTenantShares,
  calculateInfraCosts,
  type InfraCostCalculationInput,
  type InfraCostHourlyInput,
  type InfraResourceHourReading,
} from './infraCostCalculator';
import { defaultInfraCostSettings, type InfraCostItem, type InfraCostSettings } from './infraCostSettings';

const H = 3_600_000;
const FX: ResolvedFxRate = { rate: 5, referenceDate: '2026-11-10', source: 'override', fetchedAt: null, stale: false };
const NOV = new Date('2026-11-01T00:00:00.000Z');
const DEC = new Date('2026-12-01T00:00:00.000Z');

/** Só o worker ($25/instância, `1c-2g`), sem workspace: isola a conta por hora. */
function workerOnly(): InfraCostSettings {
  const s = defaultInfraCostSettings();
  s.items = s.items.filter((i) => i.key === 'worker');
  return s;
}

const hr = (start: Date, idx: number, over: Partial<InfraResourceHourReading> = {}): InfraResourceHourReading => ({
  hour: new Date(start.getTime() + idx * H), renderKey: 'worker', plan: '1c-2g', instances: 1, diskGb: null, suspended: false, ...over,
});
const range = (n: number, f: (i: number) => InfraResourceHourReading) => Array.from({ length: n }, (_, i) => f(i));

function calc(settings: InfraCostSettings, hourly: Partial<InfraCostHourlyInput>, over: Partial<InfraCostCalculationInput> = {}) {
  return calculateInfraCosts({
    settings,
    fx: FX,
    live: { sessionsConnected: null, workerInstances: null, sessionsSampledAt: null },
    now: DEC,
    capacityByPlan: [],
    scaling: { maxSessionsPerWorker: 40, alertOccupancyRatio: 0.8 },
    hourly: { monthStart: NOV, monthEnd: DEC, resourceHours: [], bandwidthGb: null, buildMinutes: null, tenants: [], ...hourly },
    ...over,
  });
}

describe('calculateInfraCosts — basis hours (COST-11)', () => {
  it('1 → 2 instâncias no meio de um mês de 30 dias = 25 + 12,50', () => {
    const rows = range(720, (i) => hr(NOV, i, { instances: i < 360 ? 1 : 2 }));
    const r = calc(workerOnly(), { resourceHours: rows });
    expect(r.basis).toBe('hours');
    expect(r.totals.total).toEqual({ usd: 37.5, brl: 187.5 });
    expect(r.totals.projected?.usd).toBe(37.5);
    expect(r.items[0]).toMatchObject({ quantity: 2, quantitySource: 'measured_hours', estimated: false, plan: '1c-2g' });
    expect(r.warnings.filter((w) => w.code === 'missing_hours')).toEqual([]);
  });

  it('fevereiro tem 672 h: mês inteiro = 25; metade = 12,50', () => {
    const feb = new Date('2027-02-01T00:00:00.000Z');
    const mar = new Date('2027-03-01T00:00:00.000Z');
    const full = calc(workerOnly(), { monthStart: feb, monthEnd: mar, resourceHours: range(672, (i) => hr(feb, i)) }, { now: mar });
    expect(full.totals.total.usd).toBe(25);
    const half = calc(
      workerOnly(),
      { monthStart: feb, monthEnd: mar, resourceHours: range(672, (i) => hr(feb, i, { suspended: i >= 336 })) },
      { now: mar },
    );
    expect(half.totals.total.usd).toBe(12.5);
  });

  it('hora sem leitura usa a quantidade manual e avisa missing_hours com a contagem', () => {
    const rows = range(720, (i) => hr(NOV, i, { instances: 3 })).filter((_, i) => i >= 72);
    const r = calc(workerOnly(), { resourceHours: rows });
    // 72 h manuais (1 instância) + 648 h com 3
    expect(r.totals.total.usd).toBeCloseTo((25 * 72 + 75 * 648) / 720, 4);
    expect(r.warnings).toContainEqual({ code: 'missing_hours', resourceKey: 'worker', count: 72 });
    expect(r.items[0]).toMatchObject({ quantitySource: 'measured_hours', estimated: true });
  });

  it('plano sem preço → item null, totalIsPartial, plan_without_price e total só do que tem preço', () => {
    const s = defaultInfraCostSettings();
    s.items = s.items.filter((i) => i.key === 'worker' || i.key === 'email');
    const rows = range(720, (i) => hr(NOV, i, { plan: i < 100 ? '1c-2g' : 'pro-ultra' }));
    const r = calc(s, { resourceHours: rows });
    const worker = r.items.find((i) => i.key === 'worker')!;
    expect(worker.cost).toBeNull();
    expect(worker.compute).toBeNull();
    expect(r.totalIsPartial).toBe(true);
    expect(r.warnings).toContainEqual({ code: 'plan_without_price', resourceKey: 'worker', plan: 'pro-ultra' });
    expect(r.totals.total.usd).toBe(23);
    expect(r.totals.projected?.usd).toBe(23);
  });

  it('projeção = realizado + última hora × horas restantes (mês em curso)', () => {
    const now = new Date(NOV.getTime() + 240 * H + 30 * 60_000); // 10 dias e meia hora
    const rows = [...range(240, (i) => hr(NOV, i, { instances: i < 120 ? 1 : 2 })), hr(NOV, 240, { instances: 9 })];
    const r = calc(workerOnly(), { resourceHours: rows }, { now });
    const realized = (25 * 120 + 50 * 120) / 720;
    expect(r.totals.total.usd).toBeCloseTo(realized, 4);
    // a hora em curso (240) não conta; projeção pela última completa (2 instâncias)
    expect(r.totals.projected?.usd).toBeCloseTo(realized + (50 / 720) * 480, 4);
  });

  it('itens sem renderKey são proporcionais às horas decorridas, sem missing_hours', () => {
    const s = defaultInfraCostSettings();
    s.items = s.items.filter((i) => i.key === 'email');
    const r = calc(s, {}, { now: new Date(NOV.getTime() + 360 * H) });
    expect(r.totals.total.usd).toBe(11.5);
    expect(r.totals.projected?.usd).toBe(23);
    expect(r.items[0]).toMatchObject({ quantitySource: 'manual', estimated: true });
    expect(r.warnings.some((w) => w.code === 'missing_hours')).toBe(false);
  });

  it('armazenamento por hora: disco lido vence o cadastrado', () => {
    const s = defaultInfraCostSettings();
    s.items = s.items.filter((i) => i.key === 'postgres');
    const rows = range(720, (i) => hr(NOV, i, { renderKey: 'postgres', plan: '0.5c-1g', diskGb: i < 360 ? 15 : 25 }));
    const r = calc(s, { resourceHours: rows });
    expect(r.items[0]).toMatchObject({ compute: { usd: 19 }, storage: { usd: 6 } });
  });
});

describe('workspace medido (COST-11)', () => {
  it('banda medida 7 GB → excedente 0,30; projeção pela média diária', () => {
    const s = workerOnly();
    s.items = [];
    const r = calc(s, { bandwidthGb: 7, buildMinutes: 300 });
    expect(r.workspace.bandwidth).toEqual({ included: 5, consumed: 7, source: 'measured', overage: 2, cost: { usd: 0.3, brl: 1.5 } });
    expect(r.workspace.build).toMatchObject({ consumed: 300, overage: 0, cost: { usd: 0 } });
    expect(r.totals.total.usd).toBe(0.3);
    const mid = calc(s, { bandwidthGb: 4 }, { now: new Date(NOV.getTime() + 360 * H) });
    expect(mid.totals.total.usd).toBe(0);
    expect(mid.totals.projected?.usd).toBe(0.45); // 8 GB no mês → 3 × 0,15
  });

  it('manual vence a medição', () => {
    const s = workerOnly();
    s.items = [];
    s.workspace.manualBandwidthGb = 6;
    const r = calc(s, { bandwidthGb: 50 });
    expect(r.workspace.bandwidth).toMatchObject({ consumed: 6, source: 'manual', cost: { usd: 0.15 } });
  });
});

describe('rateio do mês (COST-12)', () => {
  const tenants = [
    { tenantId: 't1', planSlug: 'pro', connectedHours: 720, contractedAvg: 2 },
    { tenantId: 't2', planSlug: 'pro', connectedHours: 0, contractedAvg: 1 },
    { tenantId: 't3', planSlug: 'lite', connectedHours: 720, contractedAvg: 1 },
  ];

  it('contratadas e sessão-hora por plano; sessão-mês = sessão-hora × 730', () => {
    const r = calc(workerOnly(), { resourceHours: range(720, (i) => hr(NOV, i, { instances: 1 })), tenants });
    // compartilhado = 25
    expect(r.perSession.contracted).toMatchObject({ sessions: 4, perSession: { usd: 6.25 } });
    expect(r.perSession.connected).toMatchObject({ sessions: 2, sessionHours: 1440 });
    expect(r.perSession.connected.perSessionHour?.usd).toBeCloseTo(25 / 1440, 4);
    expect(r.perSession.connected.perSession?.usd).toBeCloseTo((25 / 1440) * 730, 4);
    const lite = r.plans.find((p) => p.planSlug === 'lite')!;
    const pro = r.plans.find((p) => p.planSlug === 'pro')!;
    expect(pro).toMatchObject({ tenants: 2, contractedSessions: 3, connectedSessions: 1, share: { usd: 18.75 }, costPerTenant: { usd: 9.375 } });
    expect(pro.connectedShare?.usd).toBe(12.5);
    expect(lite).toMatchObject({ tenants: 1, share: { usd: 6.25 }, connectedShare: { usd: 12.5 } });
    expect(r.plans.map((p) => p.planSlug)).toEqual(['lite', 'pro']);
  });

  it('ociosidade = compartilhado × (1 − sessão-hora ÷ capacidade-hora); sem worker lido = null', () => {
    const r = calc(workerOnly(), { resourceHours: range(720, (i) => hr(NOV, i)), tenants });
    // capacidade = 720 × 40 = 28.800; uso 1.440 → 5%
    expect(r.idleCapacity?.usd).toBeCloseTo(25 * 0.95, 4);
    expect(calc(workerOnly(), { tenants }).idleCapacity).toBeNull();
  });

  it('por tenant: soma das partes = compartilhado; sem horas → null', () => {
    const a = allocateInfraTenantShares(30, tenants);
    expect(a.shares.reduce((s, t) => s + (t.contractedShareUsd ?? 0), 0)).toBeCloseTo(30, 6);
    expect(a.shares.find((t) => t.tenantId === 't2')!.sessionHourShareUsd).toBe(0);
    expect(allocateInfraTenantShares(30, []).perSessionHour).toBeNull();
  });
});

describe('config_drift', () => {
  const withReading = (over: Partial<InfraResourceHourReading>, mut?: (i: InfraCostItem) => void) => {
    const s = defaultInfraCostSettings();
    s.items = s.items.filter((i) => i.key === 'api');
    mut?.(s.items[0]!);
    return calc(s, { resourceHours: range(720, (i) => hr(NOV, i, { renderKey: 'api', ...over })) });
  };

  it('plano lido com preço diferente do cadastro, instâncias e disco divergentes', () => {
    const r = withReading({ plan: '2c-4g', instances: 2, diskGb: 20 });
    const drift = r.warnings.filter((w) => w.code === 'config_drift');
    expect(drift).toEqual([
      { code: 'config_drift', resourceKey: 'api', field: 'plan' },
      { code: 'config_drift', resourceKey: 'api', field: 'instances' },
      { code: 'config_drift', resourceKey: 'api', field: 'diskGb' },
    ]);
  });

  it('igual ao cadastro (rótulo diferente do id do plano) não diverge; plano sem preço não é drift', () => {
    expect(withReading({ plan: '1c-2g', instances: 1, diskGb: 15 }).warnings.some((w) => w.code === 'config_drift')).toBe(false);
    const r = withReading({ plan: 'desconhecido', instances: 1, diskGb: 15 });
    expect(r.warnings.some((w) => w.code === 'config_drift')).toBe(false);
    expect(r.warnings).toContainEqual({ code: 'plan_without_price', resourceKey: 'api', plan: 'desconhecido' });
  });

  it('worker escala sozinho: instâncias não divergem', () => {
    const r = calc(workerOnly(), { resourceHours: range(720, (i) => hr(NOV, i, { instances: 4 })) });
    expect(r.warnings.some((w) => w.code === 'config_drift')).toBe(false);
  });

  it('na foto também compara com a leitura atual', () => {
    const r = calculateInfraCosts({
      settings: defaultInfraCostSettings(),
      fx: FX,
      live: { sessionsConnected: null, workerInstances: null, sessionsSampledAt: null },
      now: NOV,
      capacityByPlan: [],
      scaling: { maxSessionsPerWorker: 40, alertOccupancyRatio: 0.8 },
      resources: [{ renderKey: 'postgres', plan: '1c-2g', instances: 1, diskGb: 15, suspended: false }],
    });
    expect(r.basis).toBe('snapshot');
    expect(r.warnings).toContainEqual({ code: 'config_drift', resourceKey: 'postgres', field: 'plan' });
  });
});
