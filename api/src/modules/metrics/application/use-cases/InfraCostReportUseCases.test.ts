import { describe, expect, it, vi } from 'vitest';
import type { IInfraCostReportReader, InfraCostOpenMonthTenantRow } from '../../domain/contracts/IInfraCostReportReader';
import type { InfraCostClosedMonthSummary } from '../../domain/contracts/IInfraCostMonthRepository';
import type { InfraCostCalculation } from '../../domain/services/infraCostCalculator';
import { defaultInfraCostSettings } from '../../domain/services/infraCostSettings';
import { INFRA_COST_TENANTS_PAGE_SIZE, ListInfraCostTenantsUseCase } from './ListInfraCostTenantsUseCase';
import { GetInfraCostHistoryUseCase } from './GetInfraCostHistoryUseCase';
import type { InfraCostSummaryOutput } from './GetInfraCostSummaryUseCase';

const NOW = new Date('2026-11-12T15:00:00.000Z');
const OCT = new Date('2026-10-01T00:00:00.000Z');

function settings() {
  const s = defaultInfraCostSettings();
  s.aiModelPrices = [{ kind: 'OPENAI', model: 'gpt-x', inputPerMTokUsd: 2, outputPerMTokUsd: 8 }];
  return s;
}

function calc(over: Partial<InfraCostCalculation> = {}): InfraCostCalculation {
  return {
    basis: 'hours',
    fx: { rate: 5, referenceDate: '2026-11-10', source: 'ptax', fetchedAt: null, stale: false },
    tenantRates: { perContractedUsd: 10, perSessionHourUsd: 0.5, projectedPerContractedUsd: 30 },
    ...over,
  } as InfraCostCalculation;
}

function summary(c: InfraCostCalculation = calc()) {
  return { execute: vi.fn(async ({ month }: { month?: string }): Promise<InfraCostSummaryOutput> => ({ month: month!, generatedAt: NOW, calculation: c, settings: settings() })) };
}

const openRow = (tenantId: string, contractedAvg = 2, connectedHours = 4): InfraCostOpenMonthTenantRow =>
  ({ tenantId, tenantName: `Cliente ${tenantId}`, planSlug: 'COPYSYNC_PRO', contractedAvg, connectedHours });

function reports(over: Partial<IInfraCostReportReader> = {}): IInfraCostReportReader & Record<keyof IInfraCostReportReader, ReturnType<typeof vi.fn>> {
  return {
    pageOpenMonth: vi.fn(async () => ({ rows: [openRow('t1')], aiUsage: [] })),
    pageClosedMonth: vi.fn(async () => []),
    listClosedMonths: vi.fn(async () => []),
    ...over,
  } as never;
}

const closedSummary = (fx: InfraCostClosedMonthSummary['fx'] = { rate: 5.2, referenceDate: new Date('2026-10-30T00:00:00Z'), source: 'ptax' }): InfraCostClosedMonthSummary =>
  ({ month: OCT, closingMethod: 'last_business_day', fx, totalUsd: 100, totals: {}, closedAt: new Date('2026-11-01T01:00:00Z') });

function useCase(deps: { summary?: ReturnType<typeof summary>; reports?: ReturnType<typeof reports>; closed?: InfraCostClosedMonthSummary | null }) {
  const months = { findClosedMonth: vi.fn(async () => deps.closed ?? null) };
  const uc = new ListInfraCostTenantsUseCase({
    summary: deps.summary ?? summary(),
    months,
    reports: deps.reports ?? reports(),
    now: () => NOW,
  });
  return { uc, months };
}

describe('ListInfraCostTenantsUseCase — mês aberto', () => {
  it('mês corrente: custo só da página pelo custo por unidade, IA pelos preços da conta, projetado', async () => {
    const r = reports({
      pageOpenMonth: vi.fn(async () => ({
        rows: [openRow('t1', 3, 10), openRow('t2', 1, 0)],
        aiUsage: [{ tenantId: 't1', kind: 'OPENAI' as const, model: 'gpt-x', calls: 2, inputTokens: 1_000_000, outputTokens: 0, missingTokenCalls: 0 }],
      })),
    });
    const s = summary();
    const { uc, months } = useCase({ summary: s, reports: r });
    const out = await uc.execute();
    expect(months.findClosedMonth).not.toHaveBeenCalled();
    expect(s.execute).toHaveBeenCalledWith({ month: '2026-11' });
    expect(r.pageOpenMonth).toHaveBeenCalledWith(
      new Date('2026-11-01T00:00:00Z'), new Date('2026-12-01T00:00:00Z'),
      { planSlug: undefined, offset: 0, limit: INFRA_COST_TENANTS_PAGE_SIZE + 1 },
    );
    expect(out).toMatchObject({ month: '2026-11', status: 'open', basis: 'hours', nextCursor: null });
    expect(out.fx).toEqual({ rate: 5, referenceDate: '2026-11-10', source: 'ptax' });
    expect(out.tenants[0]).toEqual({
      tenantId: 't1', tenantName: 'Cliente t1', planSlug: 'COPYSYNC_PRO', contractedSessions: 3, sessionHours: 10,
      shared: { usd: 30, brl: 150 },
      connectedShared: { usd: 5, brl: 25 },
      projectedShared: { usd: 90, brl: 450 },
      ai: { usd: 2, brl: 10 },
      total: { usd: 32, brl: 160 },
    });
    expect(out.tenants[1]).toMatchObject({ ai: { usd: 0, brl: 0 }, total: { usd: 10, brl: 50 } });
  });

  it('mês passado sem fechamento: conta do mês, sem projeção', async () => {
    const s = summary();
    const { uc, months } = useCase({ summary: s });
    const out = await uc.execute({ month: '2026-10' });
    expect(months.findClosedMonth).toHaveBeenCalledWith(OCT);
    expect(s.execute).toHaveBeenCalledWith({ month: '2026-10' });
    expect(out.status).toBe('open');
    expect(out.tenants[0].projectedShared).toBeNull();
  });

  it('foto (sem snapshot no mês): lista vazia, sem ler a página', async () => {
    const r = reports();
    const { uc } = useCase({ summary: summary(calc({ basis: 'snapshot', tenantRates: null })), reports: r });
    const out = await uc.execute();
    expect(out).toMatchObject({ basis: 'snapshot', tenants: [], nextCursor: null });
    expect(r.pageOpenMonth).not.toHaveBeenCalled();
  });

  it('divisor zero e sem cotação: compartilhado e total null, BRL null', async () => {
    const { uc } = useCase({
      summary: summary(calc({ fx: null, tenantRates: { perContractedUsd: null, perSessionHourUsd: null, projectedPerContractedUsd: null } })),
    });
    const out = await uc.execute();
    expect(out.fx).toBeNull();
    expect(out.tenants[0]).toMatchObject({ shared: null, connectedShared: null, projectedShared: null, total: null, ai: { usd: 0, brl: null } });
  });

  it('cursor: próxima página pelo offset assinado; cursor de outro plano recomeça', async () => {
    const rows = Array.from({ length: INFRA_COST_TENANTS_PAGE_SIZE + 1 }, (_, i) => openRow(`t${i}`));
    const r = reports({ pageOpenMonth: vi.fn(async () => ({ rows, aiUsage: [] })) });
    const { uc } = useCase({ reports: r });
    const first = await uc.execute({ planSlug: 'COPYSYNC_PRO' });
    expect(first.tenants).toHaveLength(INFRA_COST_TENANTS_PAGE_SIZE);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.nextCursor).not.toMatch(/offset|limit/);
    await uc.execute({ planSlug: 'COPYSYNC_PRO', cursor: first.nextCursor! });
    expect(r.pageOpenMonth.mock.calls[1][2]).toMatchObject({ planSlug: 'COPYSYNC_PRO', offset: INFRA_COST_TENANTS_PAGE_SIZE });
    await uc.execute({ planSlug: 'COPYSYNC_LITE', cursor: first.nextCursor! });
    expect(r.pageOpenMonth.mock.calls[2][2]).toMatchObject({ offset: 0 });
  });
});

describe('ListInfraCostTenantsUseCase — mês fechado', () => {
  it('valores congelados, cotação do fechamento, sem conta nem sessão-hora', async () => {
    const r = reports({
      pageClosedMonth: vi.fn(async () => [{
        tenantId: 't1', tenantName: 'Cliente t1', planSlug: null, contractedAvg: 0, sessionHours: 0, sharedUsd: 0, aiUsd: 1.5, totalUsd: 1.5,
      }]),
    });
    const s = summary();
    const { uc } = useCase({ summary: s, reports: r, closed: closedSummary() });
    const out = await uc.execute({ month: '2026-10', planSlug: 'COPYSYNC_LITE' });
    expect(s.execute).not.toHaveBeenCalled();
    expect(r.pageClosedMonth).toHaveBeenCalledWith(OCT, { planSlug: 'COPYSYNC_LITE', offset: 0, limit: INFRA_COST_TENANTS_PAGE_SIZE + 1 });
    expect(out).toMatchObject({ status: 'closed', basis: 'hours', fx: { rate: 5.2, referenceDate: '2026-10-30', source: 'ptax' } });
    expect(out.tenants[0]).toMatchObject({
      shared: { usd: 0, brl: 0 }, connectedShared: null, projectedShared: null, ai: { usd: 1.5, brl: 7.8 }, total: { usd: 1.5, brl: 7.8 },
    });
  });

  it('cursor do mês aberto não vale depois do fechamento', async () => {
    const rows = Array.from({ length: INFRA_COST_TENANTS_PAGE_SIZE + 1 }, (_, i) => openRow(`t${i}`));
    const open = useCase({ reports: reports({ pageOpenMonth: vi.fn(async () => ({ rows, aiUsage: [] })) }) });
    const { nextCursor } = await open.uc.execute({ month: '2026-10' });
    const r = reports();
    const { uc } = useCase({ reports: r, closed: closedSummary(null) });
    const out = await uc.execute({ month: '2026-10', cursor: nextCursor! });
    expect(r.pageClosedMonth.mock.calls[0][1]).toMatchObject({ offset: 0 });
    expect(out.fx).toBeNull();
  });
});

describe('GetInfraCostHistoryUseCase', () => {
  it('janela dos 12 meses anteriores ao corrente; BRL pela cotação congelada', async () => {
    const r = reports({
      listClosedMonths: vi.fn(async () => [{
        month: OCT, closingMethod: 'month_average' as const,
        fx: { rate: 5, referenceDate: new Date('2026-10-31T00:00:00Z'), source: 'sgs' as const },
        totalUsd: 120.25, totalIsPartial: true, closedAt: new Date('2026-11-01T01:00:00Z'),
        plans: [{ planSlug: 'COPYSYNC_PRO', tenants: 2, sharedUsd: 100, aiUsd: 2, totalUsd: 102 }],
      }]),
    });
    const out = await new GetInfraCostHistoryUseCase(r, () => NOW).execute();
    expect(r.listClosedMonths).toHaveBeenCalledWith(new Date('2025-11-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));
    expect(out.from).toBe('2025-11');
    expect(out.to).toBe('2026-10');
    expect(out.months[0]).toEqual({
      month: '2026-10', closedAt: new Date('2026-11-01T01:00:00Z'), closingMethod: 'month_average',
      fx: { rate: 5, referenceDate: '2026-10-31', source: 'sgs' },
      total: { usd: 120.25, brl: 601.25 }, totalIsPartial: true,
      plans: [{ planSlug: 'COPYSYNC_PRO', tenants: 2, shared: { usd: 100, brl: 500 }, ai: { usd: 2, brl: 10 }, total: { usd: 102, brl: 510 } }],
    });
  });

  it('janeiro: janela cruza o ano', async () => {
    const r = reports();
    const out = await new GetInfraCostHistoryUseCase(r, () => new Date('2027-01-05T00:00:00Z')).execute();
    expect(r.listClosedMonths).toHaveBeenCalledWith(new Date('2026-01-01T00:00:00Z'), new Date('2027-01-01T00:00:00Z'));
    expect(out).toEqual({ from: '2026-01', to: '2026-12', months: [] });
  });
});
