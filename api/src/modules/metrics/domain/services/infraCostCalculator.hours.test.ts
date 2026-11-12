import { describe, expect, it } from 'vitest';
import type { ResolvedFxRate } from './fxRate';
import {
  allocateInfraTenantShares,
  calculateInfraAiCosts,
  calculateInfraCosts,
  type InfraAiUsageRow,
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

  it('consumo e excedente medidos saem com 4 casas (soma de float 6,6 + 0,2 + 0,2)', () => {
    const s = workerOnly();
    s.items = [];
    const r = calc(s, { bandwidthGb: 6.6 + 0.2 + 0.2, buildMinutes: 0.1 + 0.2 });
    expect(r.workspace.bandwidth).toMatchObject({ consumed: 7, overage: 2 });
    expect(r.workspace.build.consumed).toBe(0.3);
    s.workspace.manualBandwidthGb = 6.6 + 0.2 + 0.2;
    expect(calc(s, {}).workspace.bandwidth).toMatchObject({ consumed: 7, overage: 2 });
  });

  it('horas sem banda lida → bandwidth_missing_hours (lida até F-2h no mês em curso); manual não avisa', () => {
    const s = workerOnly();
    s.items = [];
    expect(calc(s, { bandwidthGb: 7, bandwidthHours: 700 }).warnings).toContainEqual({ code: 'bandwidth_missing_hours', count: 18 });
    // Mês em curso às 10:05: job leu 00..08 → 9 horas de banda esperadas
    const mid = { now: new Date(NOV.getTime() + 10 * H + 5 * 60_000) };
    expect(calc(s, { bandwidthGb: 1, bandwidthHours: 9 }, mid).warnings.map((w) => w.code)).not.toContain('bandwidth_missing_hours');
    expect(calc(s, { bandwidthGb: 1, bandwidthHours: 8 }, mid).warnings).toContainEqual({ code: 'bandwidth_missing_hours', count: 1 });
    expect(calc(s, { bandwidthGb: 1, bandwidthHours: 5 }, mid).warnings).toContainEqual({ code: 'bandwidth_missing_hours', count: 4 });
    // 10:02: tick da hora ainda pode não ter rodado → 8 esperadas, sem aviso falso
    const early = { now: new Date(NOV.getTime() + 10 * H + 2 * 60_000) };
    expect(calc(s, { bandwidthGb: 1, bandwidthHours: 8 }, early).warnings.map((w) => w.code)).not.toContain('bandwidth_missing_hours');
    expect(calc(s, { bandwidthGb: 1, bandwidthHours: 7 }, early).warnings).toContainEqual({ code: 'bandwidth_missing_hours', count: 1 });
    expect(calc(s, { bandwidthGb: 1 }, mid).warnings.map((w) => w.code)).not.toContain('bandwidth_missing_hours');
    s.workspace.manualBandwidthGb = 6;
    expect(calc(s, { bandwidthGb: 1, bandwidthHours: 0 }).warnings.map((w) => w.code)).not.toContain('bandwidth_missing_hours');
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
    expect(r.warnings.map((w) => w.code)).not.toContain('idle_partial');
  });

  it('ociosidade com horas sem leitura do worker: só a janela lida (numerador e denominador) + idle_partial', () => {
    // 360 de 720 h lidas: compartilhado 25 (360 lidas + 360 manuais com 1 instância), sessão-hora 1.440 no mês
    const r = calc(workerOnly(), { resourceHours: range(360, (i) => hr(NOV, i)), tenants });
    // janela = 1/2: sessão-hora 720 contra capacidade 360 × 40 = 14.400 → 5%; custo 25 × 1/2 × 0,95
    expect(r.idleCapacity?.usd).toBeCloseTo(25 * 0.5 * 0.95, 4);
    expect(r.warnings).toContainEqual({ code: 'idle_partial', count: 360 });
  });

  it('rateio projetado (margem do mês corrente): contratadas × compartilhado projetado; mês cheio = realizado', () => {
    // metade do mês com 1 instância: realizado 12,50, projeção 25
    const now = new Date(NOV.getTime() + 360 * H);
    const r = calc(workerOnly(), { resourceHours: range(360, (i) => hr(NOV, i)), tenants }, { now });
    const pro = r.plans.find((p) => p.planSlug === 'pro')!;
    expect(pro.share?.usd).toBe(9.375); // 12,50 × 3/4
    expect(pro.projectedShare?.usd).toBe(18.75); // 25 × 3/4
    expect(pro.projectedCostPerTenant?.usd).toBe(9.375);
    const full = calc(workerOnly(), { resourceHours: range(720, (i) => hr(NOV, i)), tenants }).plans.find((p) => p.planSlug === 'pro')!;
    expect(full.projectedShare).toEqual(full.share);
  });

  it('foto: sem rateio projetado', () => {
    const r = calc(workerOnly(), {}, { hourly: undefined, capacityByPlan: [
      { planSlug: 'pro', tenants: 1, contracted: { whatsapp: 1, telegram: 0 }, unlimitedTenants: { whatsapp: 0, telegram: 0 },
        created: { whatsapp: 1, telegram: 0 }, connected: { whatsapp: 1, telegram: 0 } },
    ] });
    expect(r.plans[0]).toMatchObject({ projectedShare: null, projectedCostPerTenant: null });
  });

  it('Σ contratadas 0: base sessão-hora (mesma regra do fechamento) com aviso; projetado na mesma base', () => {
    const now = new Date(NOV.getTime() + 360 * H);
    const noContracted = tenants.map((t) => ({ ...t, contractedAvg: 0 }));
    const r = calc(workerOnly(), { resourceHours: range(360, (i) => hr(NOV, i)), tenants: noContracted }, { now });
    expect(r.warnings).toContainEqual({ code: 'shared_by_session_hours' });
    expect(r.tenantRates).toMatchObject({ sharedBasis: 'session_hours', perContractedUsd: null });
    expect(r.perSession.contracted.perSession).toBeNull();
    const pro = r.plans.find((p) => p.planSlug === 'pro')!;
    expect(pro.share).toEqual(pro.connectedShare);
    expect(pro.share?.usd).toBe(6.25); // 12,50 × metade das horas
    expect(pro.projectedShare?.usd).toBe(12.5); // 25 × metade das horas
    expect(r.plans.reduce((s, p) => s + (p.share?.usd ?? 0), 0)).toBeCloseTo(r.totals.shared.usd, 4);
  });

  it('sem contratadas nem sessão-hora: shared_unallocated com o valor, parte null', () => {
    const zero = tenants.map((t) => ({ ...t, contractedAvg: 0, connectedHours: 0 }));
    const r = calc(workerOnly(), { resourceHours: range(720, (i) => hr(NOV, i)), tenants: zero });
    expect(r.warnings).toContainEqual({ code: 'shared_unallocated', usd: 25 });
    expect(r.tenantRates?.sharedBasis).toBeNull();
    expect(r.plans.every((p) => p.share === null)).toBe(true);
    const base = calc(workerOnly(), { resourceHours: range(720, (i) => hr(NOV, i)), tenants });
    expect(base.warnings.map((w) => w.code)).not.toContain('shared_by_session_hours');
    expect(base.tenantRates?.sharedBasis).toBe('contracted');
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

describe('IA da plataforma por tenant (COST-13)', () => {
  const priced = (): InfraCostSettings => {
    const s = workerOnly();
    s.aiModelPrices = [{ kind: 'OPENAI', model: 'gpt-x', billing: 'tokens', inputPerMTokUsd: 2, outputPerMTokUsd: 8, monthlyUsd: null }];
    return s;
  };
  const row = (over: Partial<InfraAiUsageRow> = {}): InfraAiUsageRow => ({
    tenantId: 't1', kind: 'OPENAI', model: 'gpt-x', calls: 1, inputTokens: 0, outputTokens: 0, missingTokenCalls: 0, ...over,
  });

  it('1 M tokens de entrada = preço de entrada; saída pelo preço de saída', () => {
    expect(calculateInfraAiCosts(priced(), [row({ inputTokens: 1_000_000 })]).totalUsd).toBe(2);
    const r = calculateInfraAiCosts(priced(), [row({ inputTokens: 500_000, outputTokens: 250_000 }), row({ tenantId: 't2', outputTokens: 1_000_000 })]);
    expect(r.totalUsd).toBe(11);
    expect([...r.byTenant]).toEqual([['t1', 3], ['t2', 8]]);
    expect(r.warnings).toEqual([]);
    expect(r.partial).toBe(false);
  });

  it('linha com token nulo: contada no aviso, não somada como 0', () => {
    const r = calculateInfraAiCosts(priced(), [row({ calls: 3, inputTokens: 1_000_000, missingTokenCalls: 2 }), row({ tenantId: 't2', calls: 1, missingTokenCalls: 1 })]);
    expect(r.totalUsd).toBe(2);
    expect(r.byTenant.has('t2')).toBe(false);
    expect(r.warnings).toEqual([{ code: 'ai_tokens_missing', count: 3 }]);
    expect(r.partial).toBe(false);
  });

  it('modelo sem preço (mesmo nome, outro kind): aviso com as chamadas, fora do total, total parcial', () => {
    const r = calculateInfraAiCosts(priced(), [
      row({ kind: 'ANTHROPIC', calls: 2, inputTokens: 1_000_000 }),
      row({ tenantId: 't2', kind: 'ANTHROPIC', calls: 3, inputTokens: 5 }),
    ]);
    expect(r.totalUsd).toBe(0);
    expect(r.byTenant.size).toBe(0);
    expect(r.warnings).toEqual([{ code: 'model_without_price', kind: 'ANTHROPIC', model: 'gpt-x', count: 5 }]);
    expect(r.partial).toBe(true);
  });

  it('no cálculo do mês: direto no total e no variável, fora do compartilhado; por plano = soma dos tenants', () => {
    const tenants = [
      { tenantId: 't1', planSlug: 'lite', connectedHours: 10, contractedAvg: 1 },
      { tenantId: 't2', planSlug: 'lite', connectedHours: 10, contractedAvg: 1 },
      { tenantId: 't3', planSlug: 'pro', connectedHours: 10, contractedAvg: 2 },
    ];
    const resourceHours = range(720, (i) => hr(NOV, i));
    const base = calc(priced(), { resourceHours, tenants });
    const r = calc(priced(), {
      resourceHours,
      tenants,
      aiUsage: [row({ inputTokens: 1_000_000 }), row({ tenantId: 't3', outputTokens: 500_000 }), row({ tenantId: 'sem-horas', inputTokens: 500_000 })],
    });
    expect(base.totals.ai).toBeNull();
    expect(base.plans.every((p) => p.ai === null)).toBe(true);
    expect(r.totals.ai).toEqual({ usd: 7, brl: 35 });
    expect(r.totals.total.usd).toBe(base.totals.total.usd + 7);
    expect(r.totals.variable.usd).toBe(base.totals.variable.usd + 7);
    expect(r.totals.shared).toEqual(base.totals.shared);
    expect(r.plans.find((p) => p.planSlug === 'lite')!.ai).toEqual({ usd: 2, brl: 10 });
    expect(r.plans.find((p) => p.planSlug === 'pro')!.ai).toEqual({ usd: 4, brl: 20 });
    expect(r.plans.find((p) => p.planSlug === 'lite')!.share).toEqual(base.plans.find((p) => p.planSlug === 'lite')!.share);
    expect(r.totalIsPartial).toBe(false);
  });

  it('no cálculo do mês: avisos de IA e total parcial com modelo sem preço; leitura vazia = 0', () => {
    const r = calc(priced(), { aiUsage: [row({ model: 'novo', calls: 4, missingTokenCalls: 1 })] });
    expect(r.totalIsPartial).toBe(true);
    expect(r.warnings).toEqual(expect.arrayContaining([
      { code: 'model_without_price', kind: 'OPENAI', model: 'novo', count: 3 },
      { code: 'ai_tokens_missing', count: 1 },
    ]));
    expect(calc(priced(), { aiUsage: [] }).totals.ai).toEqual({ usd: 0, brl: 0 });
  });

  it('rateio por tenant leva a IA direta', () => {
    const a = allocateInfraTenantShares(10, [{ tenantId: 't1', planSlug: 'lite', connectedHours: 1, contractedAvg: 1 }], new Map([['t1', 1.5]]));
    expect(a.shares[0].aiUsd).toBe(1.5);
    expect(allocateInfraTenantShares(10, [{ tenantId: 't1', planSlug: null, connectedHours: 1, contractedAvg: 1 }]).shares[0].aiUsd).toBe(0);
  });
});

describe('IA mensal fixa por modelo', () => {
  const monthly = (usd = 30): InfraCostSettings => {
    const s = workerOnly();
    s.aiModelPrices = [
      { kind: 'OPENAI', model: 'gpt-x', billing: 'tokens', inputPerMTokUsd: 2, outputPerMTokUsd: 8, monthlyUsd: null },
      { kind: 'GROQ', model: 'assinatura', billing: 'monthly', inputPerMTokUsd: null, outputPerMTokUsd: null, monthlyUsd: usd },
    ];
    return s;
  };
  const row = (over: Partial<InfraAiUsageRow> = {}): InfraAiUsageRow => ({
    tenantId: 't1', kind: 'GROQ', model: 'assinatura', calls: 1, inputTokens: 0, outputTokens: 0, missingTokenCalls: 0, ...over,
  });
  const tenants = [
    { tenantId: 't1', planSlug: 'lite', connectedHours: 10, contractedAvg: 1 },
    { tenantId: 't2', planSlug: 'pro', connectedHours: 10, contractedAvg: 3 },
  ];
  const resourceHours = range(720, (i) => hr(NOV, i));

  it('rateado pela proporção de tokens (entrada + saída) do modelo no mês', () => {
    const r = calculateInfraAiCosts(monthly(), [row({ inputTokens: 100, outputTokens: 200 }), row({ tenantId: 't2', inputTokens: 700 }), row({ model: 'gpt-x', kind: 'OPENAI', inputTokens: 1_000_000 })]);
    expect(r.totalUsd).toBeCloseTo(32, 6);
    expect(r.byTenant.get('t1')).toBeCloseTo(9 + 2, 6);
    expect(r.byTenant.get('t2')).toBeCloseTo(21, 6);
    expect(r.unattributedUsd).toBe(0);
    expect(r.monthlyUsdPerToken['GROQ:assinatura']).toBeCloseTo(0.03, 9);
    expect(r.warnings).toEqual([]);
  });

  it('página de tenants usa a taxa por token do mês inteiro', () => {
    const r = calculateInfraAiCosts(monthly(), [row({ tenantId: 't2', inputTokens: 700 })], { monthlyUsdPerToken: { 'GROQ:assinatura': 0.03 } });
    expect(r.byTenant.get('t2')).toBeCloseTo(21, 6);
    expect(r.totalUsd).toBeCloseTo(21, 6);
  });

  it('sem tokens no mês: vai para o compartilhado com aviso; total e fixo levam o mensal', () => {
    const base = calc(workerOnly(), { resourceHours, tenants, aiUsage: [] });
    const r = calc(monthly(), { resourceHours, tenants, aiUsage: [] });
    expect(r.warnings).toContainEqual({ code: 'ai_monthly_unused', kind: 'GROQ', model: 'assinatura', usd: 30 });
    expect(r.totals.ai).toEqual({ usd: 0, brl: 0 });
    expect(r.totals.shared.usd).toBeCloseTo(base.totals.shared.usd + 30, 4);
    expect(r.totals.total.usd).toBeCloseTo(base.totals.total.usd + 30, 4);
    expect(r.totals.fixed.usd).toBeCloseTo(base.totals.fixed.usd + 30, 4);
    expect(r.totals.variable).toEqual(base.totals.variable);
    // compartilhado rateado por contratadas: t1 1/4, t2 3/4
    expect(r.tenantRates!.perContractedUsd! * 4).toBeCloseTo(r.totals.shared.usd, 4);
  });

  it('com tokens: IA direta do tenant, fora do compartilhado; Σ tenants + não rateado = total', () => {
    const base = calc(workerOnly(), { resourceHours, tenants, aiUsage: [] });
    const r = calc(monthly(), { resourceHours, tenants, aiUsage: [row({ inputTokens: 1 }), row({ tenantId: 't2', inputTokens: 2 })] });
    expect(r.totals.ai!.usd).toBeCloseTo(30, 4);
    expect(r.totals.shared).toEqual(base.totals.shared);
    expect(r.plans.find((p) => p.planSlug === 'lite')!.ai!.usd).toBeCloseTo(10, 4);
    expect(r.plans.find((p) => p.planSlug === 'pro')!.ai!.usd).toBeCloseTo(20, 4);
    const sumTenants = r.plans.reduce((s, p) => s + p.share!.usd + p.ai!.usd, 0);
    expect(sumTenants).toBeCloseTo(r.totals.total.usd, 3);
    expect(r.tenantRates!.aiMonthlyUsdPerToken).toEqual({ 'GROQ:assinatura': 10 });
  });

  it('mês parcial: realizado proporcional às horas decorridas, projeção = mês cheio', () => {
    const half = new Date(NOV.getTime() + 360 * H);
    const r = calc(monthly(), { resourceHours: range(360, (i) => hr(NOV, i)), tenants, aiUsage: [row({ inputTokens: 5 })] }, { now: half });
    const base = calc(workerOnly(), { resourceHours: range(360, (i) => hr(NOV, i)), tenants, aiUsage: [] }, { now: half });
    expect(r.totals.ai!.usd).toBeCloseTo(15, 4);
    expect(r.totals.total.usd).toBeCloseTo(base.totals.total.usd + 15, 4);
    expect(r.totals.projected!.usd).toBeCloseTo(base.totals.projected!.usd + 30, 4);
    const unused = calc(monthly(), { resourceHours: range(360, (i) => hr(NOV, i)), tenants, aiUsage: [] }, { now: half });
    expect(unused.warnings).toContainEqual({ code: 'ai_monthly_unused', kind: 'GROQ', model: 'assinatura', usd: 15 });
    expect(unused.totals.shared.usd).toBeCloseTo(base.totals.shared.usd + 15, 4);
  });
});
