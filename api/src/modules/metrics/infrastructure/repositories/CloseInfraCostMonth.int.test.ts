import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../../../shared/database/prisma.client';
import {
  CloseInfraCostMonthUseCase,
  type InfraCostClosedMonthTotals,
} from '../../application/use-cases/CloseInfraCostMonthUseCase';
import { GetInfraCostSummaryUseCase } from '../../application/use-cases/GetInfraCostSummaryUseCase';
import type { InfraFxRateSource } from '../../domain/contracts/IInfraCostSnapshotRepository';
import { defaultInfraCostSettings, type InfraCostSettings, type InfraFxClosingMethod } from '../../domain/services/infraCostSettings';
import { PrismaInfraCostSnapshotRepository } from './PrismaInfraCostSnapshotRepository';
import { PrismaInfraCostReportReader } from './PrismaInfraCostReportReader';
import { PrismaInfraCostUsageReader } from './PrismaInfraCostUsageReader';

/** Fechamento mensal (COST-15) contra Postgres local: repositório + leitor reais, configuração em memória. */
const HOUR = 3_600_000;
const OCT = new Date('2026-10-01T00:00:00.000Z');
const NOW = new Date('2026-11-01T01:05:00.000Z');
const T1 = 'tenant-ic-month-1';
const T2 = 'tenant-ic-month-2';
const at = (h: number) => new Date(OCT.getTime() + h * HOUR);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

const repo = new PrismaInfraCostSnapshotRepository(prisma);
let settings: InfraCostSettings;

function useCase() {
  return new CloseInfraCostMonthUseCase({
    months: repo,
    fxRates: repo,
    settings: { get: async () => ({ value: structuredClone(settings), updatedAt: new Date(0), updatedById: null }), save: async () => { throw new Error('não usado'); } },
    usage: new PrismaInfraCostUsageReader(prisma),
    scaling: { current: () => ({ value: { maxSessionsPerWorker: 100, alertOccupancyRatio: 0.8 } }) } as never,
  });
}

/** Resumo com repositórios reais; `months` ausente = recálculo (como antes do COST-15 no resumo). */
function summaryUseCase(withMonths = true) {
  return new GetInfraCostSummaryUseCase({
    settings: { get: async () => ({ value: structuredClone(settings), updatedAt: new Date(0), updatedById: null }), save: async () => { throw new Error('não usado'); } },
    live: { read: async () => { throw new Error('mês passado não lê a foto'); } } as never,
    capacity: { readByPlan: async () => { throw new Error('mês passado não lê a capacidade'); } },
    scaling: { current: () => ({ value: { maxSessionsPerWorker: 100, alertOccupancyRatio: 0.8 } }) } as never,
    fxRates: repo,
    usage: new PrismaInfraCostUsageReader(prisma),
    months: withMonths ? repo : undefined,
    now: () => NOW,
  });
}

const fxRate = (d: string, rate: number, source: InfraFxRateSource = 'ptax') =>
  repo.upsertFxRate({ referenceDate: day(d), rate, source, fetchedAt: new Date(`${d}T17:00:00Z`) });

const clean = async () => {
  await prisma.infraCostMonth.deleteMany({});
  await prisma.infraResourceHour.deleteMany({});
  await prisma.tenantSessionHour.deleteMany({});
  await prisma.infraFxRate.deleteMany({});
  await prisma.infraUsageDaily.deleteMany({});
  await prisma.aiUsageLog.deleteMany({ where: { tenantId: { in: [T1, T2] } } });
};

async function seedMonth() {
  await repo.upsertResourceHours(
    [0, 1, 743].map((h) => ({ hour: at(h), resourceKey: 'api' as const, plan: '1c-2g', instances: 1, instancesSource: 'render' as const, diskGb: 15, suspended: false })),
  );
  // T1: 3 contratadas, 2 conectadas; T2: 1 contratada, 1 conectada (duas horas)
  for (const h of [0, 1]) {
    await repo.addSessionHour(at(h), [
      { tenantId: T1, planSlug: 'COPYSYNC_PRO', connectedSessions: 2, contractedSessions: 3 },
      { tenantId: T2, planSlug: 'COPYSYNC_LITE', connectedSessions: 1, contractedSessions: 1 },
    ]);
  }
  // IA da plataforma: 1 M tokens de entrada de T1 (US$ 2 com o preço abaixo)
  await prisma.aiUsageLog.create({
    data: { tenantId: T1, createdAt: at(5), source: 'PLATFORM', kind: 'OPENAI', model: 'gpt-x', purpose: 'teste', inputTokens: 1_000_000, outputTokens: 0, success: true },
  });
}

const totalsOf = async () => (await repo.findClosedMonth(OCT))!.totals as unknown as InfraCostClosedMonthTotals;

beforeAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [T1, T2] } } });
  await prisma.tenant.createMany({ data: [{ id: T1, name: 'A', slug: 'ic-month-1' }, { id: T2, name: 'B', slug: 'ic-month-2' }] });
});
beforeEach(async () => {
  await clean();
  settings = defaultInfraCostSettings();
  settings.fx.auto = true;
  settings.aiModelPrices = [{ kind: 'OPENAI', model: 'gpt-x', billing: 'tokens', inputPerMTokUsd: 2, outputPerMTokUsd: 8, monthlyUsd: null }];
});
afterAll(async () => {
  await clean();
  await prisma.tenant.deleteMany({ where: { id: { in: [T1, T2] } } });
  await prisma.$disconnect();
});

describe('CloseInfraCostMonthUseCase + PrismaInfraCostSnapshotRepository (Postgres)', () => {
  it('fecha o mês: totais, cotação, método e tenants (compartilhado por contratadas + IA)', async () => {
    await seedMonth();
    await fxRate('2026-09-30', 5.1);
    await fxRate('2026-10-01', 5.2, 'sgs');
    await fxRate('2026-10-30', 5.6);
    await fxRate('2026-11-01', 9.9); // fora do mês

    expect(await useCase().execute({ month: '2026-10', now: NOW })).toBe('closed');

    const month = await repo.findClosedMonth(OCT);
    expect(month).toMatchObject({ closingMethod: 'last_business_day', fx: { rate: 5.6, referenceDate: day('2026-10-30'), source: 'ptax' } });
    const totals = await totalsOf();
    expect(totals.calculation.basis).toBe('hours');
    expect(totals.calculation.warnings.some((w) => w.code === 'fx_fallback')).toBe(false);
    expect(totals.calculation.totals.ai?.usd).toBe(2);
    expect(month!.totalUsd).toBeCloseTo(totals.calculation.totals.total.usd, 4);

    const rows = await prisma.infraCostMonthTenant.findMany({ where: { month: OCT }, orderBy: { totalUsd: 'desc' } });
    const shared = totals.calculation.totals.shared.usd;
    expect(rows.map((r) => r.tenantId)).toEqual([T1, T2]);
    const [r1, r2] = rows;
    expect(r1).toMatchObject({ planSlug: 'COPYSYNC_PRO', contractedAvg: 3, sessionHours: 4 });
    expect(r1.sharedUsd.toNumber()).toBeCloseTo((shared * 3) / 4, 3);
    expect(r1.aiUsd.toNumber()).toBe(2);
    expect(r1.totalUsd.toNumber()).toBeCloseTo(r1.sharedUsd.toNumber() + 2, 4);
    expect(r2.sharedUsd.toNumber()).toBeCloseTo(shared / 4, 3);
    expect(r2.aiUsd.toNumber()).toBe(0);
  });

  it('fechar duas vezes (inclusive em paralelo) não duplica; preço editado depois não muda o mês fechado', async () => {
    await seedMonth();
    await fxRate('2026-10-15', 5.3);
    const results = await Promise.all([useCase().execute({ month: '2026-10', now: NOW }), useCase().execute({ month: '2026-10', now: NOW })]);
    expect(results.sort()).toEqual(['already_closed', 'closed']);
    const before = await repo.findClosedMonth(OCT);

    settings.items = settings.items.map((i) => (i.key === 'api' ? { ...i, monthlyUsd: i.monthlyUsd * 10 } : i));
    settings.fx.override = { rate: 7, date: '2026-10-31' };
    expect(await useCase().execute({ month: '2026-10', now: NOW })).toBe('already_closed');

    const after = await repo.findClosedMonth(OCT);
    expect(after).toEqual(before);
    expect((await totalsOf()).settings.items.find((i) => i.key === 'api')?.monthlyUsd).toBe(25);
    expect(await prisma.infraCostMonthTenant.count({ where: { month: OCT } })).toBe(2);
  });

  it('resumo do mês fechado lê o congelado: preço e cotação editados depois não mudam o resumo', async () => {
    await seedMonth();
    await fxRate('2026-10-30', 5.6);
    const open = await summaryUseCase().execute({ month: '2026-10' });
    expect(open.closed).toBe(false);

    expect(await useCase().execute({ month: '2026-10', now: NOW })).toBe('closed');
    const frozen = await totalsOf();
    const closedAt = (await repo.findClosedMonth(OCT))!.closedAt;

    settings.items = settings.items.map((i) => (i.key === 'api' ? { ...i, monthlyUsd: i.monthlyUsd * 10 } : i));
    settings.aiModelPrices = [{ kind: 'OPENAI', model: 'gpt-x', billing: 'tokens', inputPerMTokUsd: 20, outputPerMTokUsd: 80, monthlyUsd: null }];
    settings.fx.override = { rate: 7, date: '2026-10-31' };
    await fxRate('2026-10-31', 6.1);

    const out = await summaryUseCase().execute({ month: '2026-10' });
    expect(out.closed).toBe(true);
    expect(out.generatedAt).toEqual(closedAt);
    expect(out.calculation.totals).toEqual(frozen.calculation.totals);
    expect(out.calculation.totals.total.usd).toBe(open.calculation.totals.total.usd);
    expect(out.calculation.fx).toMatchObject({ rate: 5.6, referenceDate: '2026-10-30', source: 'ptax' });
    expect(out.calculation.fx?.fetchedAt).toBeInstanceOf(Date);
    expect(out.settings.items.find((i) => i.key === 'api')?.monthlyUsd).toBe(25);

    // Sem o congelado, a mesma conta já usaria o preço novo (prova de que a edição pesaria)
    const recalculated = await summaryUseCase(false).execute({ month: '2026-10' });
    expect(recalculated.closed).toBe(false);
    expect(recalculated.calculation.totals.total.usd).toBeGreaterThan(out.calculation.totals.total.usd);
    expect(recalculated.calculation.fx?.rate).toBe(7);
  });

  it.each<[InfraFxClosingMethod, number]>([
    ['last_business_day', 5.6],
    ['month_average', 5.4],
  ])('%s com cotação no mês = %s; sem cotação no mês → última antes (fx_fallback)', async (method, expected) => {
    settings.fx.closingMethod = method;
    await seedMonth();
    await fxRate('2026-09-30', 5.1);
    await fxRate('2026-10-01', 5.2);
    await fxRate('2026-10-30', 5.6);
    await useCase().execute({ month: '2026-10', now: NOW });
    expect(await repo.findClosedMonth(OCT)).toMatchObject({ closingMethod: method, fx: { rate: expected, referenceDate: day('2026-10-30') } });

    await prisma.infraCostMonth.deleteMany({});
    await prisma.infraFxRate.deleteMany({ where: { referenceDate: { gte: OCT } } });
    await useCase().execute({ month: '2026-10', now: NOW });
    expect(await repo.findClosedMonth(OCT)).toMatchObject({ closingMethod: method, fx: { rate: 5.1, referenceDate: day('2026-09-30'), source: 'ptax' } });
    expect((await totalsOf()).calculation.warnings).toContainEqual({ code: 'fx_fallback' });
  });

  it('override ativo vence; sem cotação nenhuma = fx null (fx_missing, só USD)', async () => {
    await seedMonth();
    settings.fx.override = { rate: 6.25, date: '2026-10-20' };
    await useCase().execute({ month: '2026-10', now: NOW });
    expect((await repo.findClosedMonth(OCT))!.fx).toEqual({ rate: 6.25, referenceDate: day('2026-10-20'), source: 'override' });

    await prisma.infraCostMonth.deleteMany({});
    settings.fx.override = null;
    await useCase().execute({ month: '2026-10', now: NOW });
    expect((await repo.findClosedMonth(OCT))!.fx).toBeNull();
    expect((await totalsOf()).calculation.warnings).toContainEqual({ code: 'fx_missing' });
  });

  /**
   * Σ tenants (compartilhado + IA) + não rateado = compartilhado + IA; + fora do rateio (`excluded` e IA fixa) =
   * total congelado (`infra_cost_months.totalUsd`).
   */
  async function expectAllocated() {
    const totals = await totalsOf();
    const month = (await repo.findClosedMonth(OCT))!;
    const rows = await prisma.infraCostMonthTenant.findMany({ where: { month: OCT } });
    const unallocated = totals.calculation.warnings.find((w) => w.code === 'shared_unallocated');
    const sum = rows.reduce((acc, r) => acc + r.totalUsd.toNumber(), 0);
    expect(totals.allocation.unallocatedUsd).toBeCloseTo(unallocated?.code === 'shared_unallocated' ? unallocated.usd : 0, 4);
    expect(sum + totals.allocation.unallocatedUsd)
      .toBeCloseTo(totals.calculation.totals.shared.usd + (totals.calculation.totals.ai?.usd ?? 0), 3);
    expect(sum + totals.allocation.unallocatedUsd + totals.allocation.excludedUsd).toBeCloseTo(month.totalUsd, 3);
    return { totals, rows, unallocated };
  }

  it('itens fora do rateio (excluded e IA fixa) entram no total e não nos tenants: Σ tenants + não rateado + excluded = total', async () => {
    settings.items.push(
      { key: 'fora', label: 'Fora do rateio', category: 'other', billing: 'fixed', monthlyUsd: 31, quantity: 1, storage: null, renderKey: null, planLabel: null, allocation: 'excluded', note: null },
      { key: 'ia-fixa', label: 'IA fixa', category: 'ai', billing: 'fixed', monthlyUsd: 20, quantity: 1, storage: null, renderKey: null, planLabel: null, allocation: 'shared', note: null },
    );
    await seedMonth();
    expect(await useCase().execute({ month: '2026-10', now: NOW })).toBe('closed');
    const { totals } = await expectAllocated();
    // Mês inteiro de 31 dias: os dois itens fixos entram cheios no total e só nele
    expect(totals.allocation.excludedUsd).toBeGreaterThanOrEqual(51 - 0.001);
    const history = await new PrismaInfraCostReportReader(prisma).listClosedMonths(OCT, new Date('2026-11-01T00:00:00Z'));
    expect(history[0]).toMatchObject({ excludedUsd: totals.allocation.excludedUsd, unallocatedUsd: 0 });
  });

  it('IA mensal fixa: com tokens vai ao tenant, sem tokens vai ao compartilhado; invariante fecha', async () => {
    settings.aiModelPrices = [
      { kind: 'OPENAI', model: 'gpt-x', billing: 'monthly', inputPerMTokUsd: null, outputPerMTokUsd: null, monthlyUsd: 40 },
      { kind: 'GROQ', model: 'sem-uso', billing: 'monthly', inputPerMTokUsd: null, outputPerMTokUsd: null, monthlyUsd: 12 },
    ];
    await seedMonth();
    expect(await useCase().execute({ month: '2026-10', now: NOW })).toBe('closed');
    const { totals, rows } = await expectAllocated();
    expect(totals.calculation.totals.ai?.usd).toBe(40);
    expect(totals.calculation.warnings).toContainEqual({ code: 'ai_monthly_unused', kind: 'GROQ', model: 'sem-uso', usd: 12 });
    expect(rows.find((r) => r.tenantId === T1)!.aiUsd.toNumber()).toBe(40);
    // Preço congelado leva o modo
    expect(totals.settings.aiModelPrices[1]).toMatchObject({ billing: 'monthly', monthlyUsd: 12 });
  });

  it('rateio por contratadas fecha a invariante (Σ tenants = compartilhado + IA)', async () => {
    await seedMonth();
    expect(await useCase().execute({ month: '2026-10', now: NOW })).toBe('closed');
    const { unallocated, totals } = await expectAllocated();
    expect(unallocated).toBeUndefined();
    expect(totals.calculation.totals.shared.usd).toBeGreaterThan(0);
  });

  it('Σ contratadas = 0: rateia o compartilhado pela sessão-hora do mês', async () => {
    await repo.upsertResourceHours([0, 1].map((h) => ({ hour: at(h), resourceKey: 'api' as const, plan: '1c-2g', instances: 1, instancesSource: 'render' as const, diskGb: 15, suspended: false })));
    for (const h of [0, 1]) {
      await repo.addSessionHour(at(h), [
        { tenantId: T1, planSlug: 'COPYSYNC_PRO', connectedSessions: 3, contractedSessions: 0 },
        { tenantId: T2, planSlug: 'COPYSYNC_LITE', connectedSessions: 1, contractedSessions: 0 },
      ]);
    }
    expect(await useCase().execute({ month: '2026-10', now: NOW })).toBe('closed');
    const { rows, unallocated, totals } = await expectAllocated();
    expect(unallocated).toBeUndefined();
    const shared = totals.calculation.totals.shared.usd;
    expect(shared).toBeGreaterThan(0);
    const byId = new Map(rows.map((r) => [r.tenantId, r.sharedUsd.toNumber()]));
    expect(byId.get(T1)).toBeCloseTo((shared * 3) / 4, 3);
    expect(byId.get(T2)).toBeCloseTo(shared / 4, 3);
    expect(totals.calculation.warnings).toContainEqual({ code: 'shared_by_session_hours' });
  });

  it('sem contratadas nem sessão-hora: shared_unallocated com o valor e Σ tenants + não rateado = compartilhado + IA', async () => {
    await repo.upsertResourceHours([0, 1].map((h) => ({ hour: at(h), resourceKey: 'api' as const, plan: '1c-2g', instances: 1, instancesSource: 'render' as const, diskGb: 15, suspended: false })));
    await prisma.aiUsageLog.create({
      data: { tenantId: T1, createdAt: at(5), source: 'PLATFORM', kind: 'OPENAI', model: 'gpt-x', purpose: 'teste', inputTokens: 1_000_000, outputTokens: 0, success: true },
    });
    expect(await useCase().execute({ month: '2026-10', now: NOW })).toBe('closed');
    const { rows, unallocated, totals } = await expectAllocated();
    expect(unallocated).toEqual({ code: 'shared_unallocated', usd: expect.closeTo(totals.calculation.totals.shared.usd, 3) });
    expect(totals.calculation.totals.shared.usd).toBeGreaterThan(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: T1, planSlug: null });
    expect(rows[0].sharedUsd.toNumber()).toBe(0);
    expect(rows[0].aiUsd.toNumber()).toBe(2);
  });

  it('fechamento forçado no fim do prazo grava usage_incomplete com as medições que faltaram', async () => {
    await seedMonth();
    expect(await useCase().execute({ month: '2026-10', now: NOW, incompleteUsage: ['bandwidth', 'build'] })).toBe('closed');
    expect((await totalsOf()).calculation.warnings).toContainEqual({ code: 'usage_incomplete', metrics: ['bandwidth', 'build'] });
  });

  it('usageKeys: por recurso, dias [from, to) e métrica; com minLastHour só quem já somou a hora', async () => {
    await repo.upsertUsageDay({ day: day('2026-10-31'), metric: 'build_minutes', resourceKey: 'api', value: 0, source: 'render_deploys' });
    await repo.upsertUsageDay({ day: day('2026-10-30'), metric: 'build_minutes', resourceKey: 'worker', value: 3, source: 'render_deploys' });
    await repo.addUsageHour(new Date('2026-10-31T23:00:00Z'), { metric: 'bandwidth_gb', resourceKey: 'api', value: 1, source: 'render_metrics' });
    await repo.addUsageHour(new Date('2026-10-31T22:00:00Z'), { metric: 'bandwidth_gb', resourceKey: 'static', value: 1, source: 'render_metrics' });
    expect(await repo.usageKeys('build_minutes', day('2026-10-31'), day('2026-11-01'))).toEqual(['api']);
    expect(await repo.usageKeys('build_minutes', OCT, day('2026-11-01'))).toEqual(['api', 'worker']);
    expect(await repo.usageKeys('bandwidth_gb', OCT, day('2026-11-01'))).toEqual(['api', 'static']);
    expect(await repo.usageKeys('bandwidth_gb', day('2026-10-31'), day('2026-11-01'), new Date('2026-10-31T23:00:00Z'))).toEqual(['api']);
    expect(await repo.usageKeys('bandwidth_gb', day('2026-11-01'), day('2026-11-02'))).toEqual([]);
  });

  it('oldestUnclosedMonth: o mais antigo com snapshot e sem fechamento na janela', async () => {
    const window = [new Date('2025-11-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z')] as const;
    expect(await repo.oldestUnclosedMonth(...window)).toBeNull();
    await repo.addSessionHour(new Date('2026-08-15T10:00:00Z'), [{ tenantId: T1, planSlug: null, connectedSessions: 1, contractedSessions: 1 }]);
    await seedMonth();
    // Fora da janela (mês corrente e anterior a `from`) não conta
    await repo.upsertResourceHours([{ hour: new Date('2026-11-02T00:00:00Z'), resourceKey: 'api', plan: '1c-2g', instances: 1, instancesSource: 'render', diskGb: 15, suspended: false }]);
    await repo.upsertResourceHours([{ hour: new Date('2025-10-31T23:00:00Z'), resourceKey: 'api', plan: '1c-2g', instances: 1, instancesSource: 'render', diskGb: 15, suspended: false }]);
    expect((await repo.oldestUnclosedMonth(...window))?.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(await useCase().execute({ month: '2026-08', now: NOW })).toBe('closed');
    expect((await repo.oldestUnclosedMonth(...window))?.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(await useCase().execute({ month: '2026-10', now: NOW })).toBe('closed');
    expect(await repo.oldestUnclosedMonth(...window)).toBeNull();
  });

  it('mês sem snapshot não fecha; mês em curso não fecha', async () => {
    expect(await useCase().execute({ month: '2026-10', now: NOW })).toBe('no_data');
    expect(await useCase().execute({ month: '2026-11', now: NOW })).toBe('not_finished');
    expect(await prisma.infraCostMonth.count()).toBe(0);
  });

  it('fxRatesBetween devolve só [início, fim) em ordem', async () => {
    await fxRate('2026-10-31', 5.5);
    await fxRate('2026-09-30', 5.1);
    await fxRate('2026-10-02', 5.2);
    await fxRate('2026-11-01', 5.9);
    const rows = await repo.fxRatesBetween(OCT, day('2026-11-01'));
    expect(rows.map((r) => [r.referenceDate.toISOString().slice(0, 10), r.rate])).toEqual([['2026-10-02', 5.2], ['2026-10-31', 5.5]]);
  });
});
