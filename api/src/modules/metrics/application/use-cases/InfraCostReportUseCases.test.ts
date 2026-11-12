import { describe, expect, it, vi } from 'vitest';
import type { IInfraCostReportReader, InfraCostOpenMonthTenantRow } from '../../domain/contracts/IInfraCostReportReader';
import type { InfraCostClosedMonthSummary } from '../../domain/contracts/IInfraCostMonthRepository';
import type { InfraCostCalculation } from '../../domain/services/infraCostCalculator';
import { defaultInfraCostSettings } from '../../domain/services/infraCostSettings';
import { INFRA_COST_TENANTS_PAGE_SIZE, ListInfraCostTenantsUseCase } from './ListInfraCostTenantsUseCase';
import { createInfraCostTenantCursor } from './infraCostTenantCursor';
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
    tenantRates: { sharedBasis: 'contracted', perContractedUsd: 10, perSessionHourUsd: 0.5, projectedPerContractedUsd: 30, projectedPerSessionHourUsd: 1.5 },
    ...over,
  } as InfraCostCalculation;
}

function summary(c: InfraCostCalculation = calc()) {
  return { execute: vi.fn(async ({ month }: { month?: string }): Promise<InfraCostSummaryOutput> => ({ month: month!, generatedAt: NOW, calculation: c, settings: settings(), closed: false })) };
}

const openRow = (tenantId: string, contractedAvg = 2, connectedHours = 4): InfraCostOpenMonthTenantRow =>
  ({ tenantId, tenantName: `Cliente ${tenantId}`, sortKey: `cliente ${tenantId}`, planSlug: 'COPYSYNC_PRO', contractedAvg, connectedHours });

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
      { planSlug: undefined, after: undefined, limit: INFRA_COST_TENANTS_PAGE_SIZE + 1 },
    );
    expect(out).toMatchObject({ month: '2026-11', status: 'open', basis: 'hours', sharedBasis: 'contracted', unallocated: null, excluded: null, nextCursor: null });
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
      summary: summary(calc({
        fx: null,
        tenantRates: { sharedBasis: null, perContractedUsd: null, perSessionHourUsd: null, projectedPerContractedUsd: null, projectedPerSessionHourUsd: null },
      })),
    });
    const out = await uc.execute();
    expect(out.fx).toBeNull();
    expect(out.sharedBasis).toBeNull();
    expect(out.tenants[0]).toMatchObject({ shared: null, connectedShared: null, projectedShared: null, total: null, ai: { usd: 0, brl: null } });
  });

  it('Σ contratadas 0: compartilhado pela sessão-hora (mesma regra do fechamento), projetado na mesma base', async () => {
    const { uc } = useCase({
      summary: summary(calc({
        tenantRates: { sharedBasis: 'session_hours', perContractedUsd: null, perSessionHourUsd: 0.5, projectedPerContractedUsd: null, projectedPerSessionHourUsd: 1.5 },
      })),
      reports: reports({ pageOpenMonth: vi.fn(async () => ({ rows: [openRow('t1', 0, 10)], aiUsage: [] })) }),
    });
    const out = await uc.execute();
    expect(out.sharedBasis).toBe('session_hours');
    expect(out.tenants[0]).toMatchObject({
      shared: { usd: 5, brl: 25 }, connectedShared: { usd: 5, brl: 25 }, projectedShared: { usd: 15, brl: 75 }, total: { usd: 5, brl: 25 },
    });
  });

  it('cursor keyset: próxima página pela última linha; sem offset nem limit no cursor', async () => {
    const rows = Array.from({ length: INFRA_COST_TENANTS_PAGE_SIZE + 1 }, (_, i) => openRow(`t${String(i).padStart(2, '0')}`));
    const r = reports({ pageOpenMonth: vi.fn(async () => ({ rows, aiUsage: [] })) });
    const { uc } = useCase({ reports: r });
    const first = await uc.execute({ planSlug: 'COPYSYNC_PRO' });
    expect(first.tenants).toHaveLength(INFRA_COST_TENANTS_PAGE_SIZE);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.nextCursor).not.toMatch(/offset|limit/);
    await uc.execute({ planSlug: 'COPYSYNC_PRO', cursor: first.nextCursor! });
    const last = rows[INFRA_COST_TENANTS_PAGE_SIZE - 1];
    expect(r.pageOpenMonth.mock.calls[1][2]).toEqual({
      planSlug: 'COPYSYNC_PRO', after: { sortKey: last.sortKey, tenantId: last.tenantId }, limit: INFRA_COST_TENANTS_PAGE_SIZE + 1,
    });
  });

  it.each([
    ['de outro plano', (c: string) => ({ planSlug: 'COPYSYNC_LITE', cursor: c })],
    ['de outro mês', (c: string) => ({ planSlug: 'COPYSYNC_PRO', month: '2026-10', cursor: c })],
    ['adulterado', (c: string) => ({ planSlug: 'COPYSYNC_PRO', cursor: `${Buffer.from('{"k":"z","t":"x"}').toString('base64url')}${c.slice(c.indexOf('~'))}` })],
    ['sem formato', () => ({ planSlug: 'COPYSYNC_PRO', cursor: 'lixo' })],
  ])('cursor %s: 400 INFRA_COST_CURSOR_INVALID, nunca a página 1', async (_label, input) => {
    const rows = Array.from({ length: INFRA_COST_TENANTS_PAGE_SIZE + 1 }, (_, i) => openRow(`t${i}`));
    const r = reports({ pageOpenMonth: vi.fn(async () => ({ rows, aiUsage: [] })) });
    const { uc } = useCase({ reports: r });
    const { nextCursor } = await uc.execute({ planSlug: 'COPYSYNC_PRO' });
    await expect(uc.execute(input(nextCursor!))).rejects.toMatchObject({ code: 'INFRA_COST_CURSOR_INVALID', statusCode: 400 });
    expect(r.pageOpenMonth).toHaveBeenCalledTimes(1);
  });

  it('cursor expirado: 400', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-12T14:00:00Z'));
      const cursor = createInfraCostTenantCursor('infra-cost-tenants:2026-11:open:*', { sortKey: 'a', tenantId: 't1' });
      vi.setSystemTime(new Date('2026-11-12T15:00:00Z'));
      const { uc } = useCase({});
      await expect(uc.execute({ cursor })).rejects.toMatchObject({ code: 'INFRA_COST_CURSOR_INVALID' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ListInfraCostTenantsUseCase — mês fechado', () => {
  it('valores congelados, cotação do fechamento, sem conta nem sessão-hora', async () => {
    const r = reports({
      pageClosedMonth: vi.fn(async () => [{
        tenantId: 't1', tenantName: 'Cliente t1', planSlug: null, contractedAvg: 0, sessionHours: 0, sharedUsd: 0, aiUsd: 1.5, totalUsd: 1.5, sortKey: '1.5000',
      }]),
    });
    const s = summary();
    const closed = {
      ...closedSummary(),
      totals: { calculation: { warnings: [{ code: 'shared_by_session_hours' }] }, allocation: { unallocatedUsd: 0, excludedUsd: 3 } },
    };
    const { uc } = useCase({ summary: s, reports: r, closed });
    const out = await uc.execute({ month: '2026-10', planSlug: 'COPYSYNC_LITE' });
    expect(s.execute).not.toHaveBeenCalled();
    expect(r.pageClosedMonth).toHaveBeenCalledWith(OCT, { planSlug: 'COPYSYNC_LITE', after: undefined, limit: INFRA_COST_TENANTS_PAGE_SIZE + 1 });
    expect(out).toMatchObject({
      status: 'closed', basis: 'hours', fx: { rate: 5.2, referenceDate: '2026-10-30', source: 'ptax' },
      sharedBasis: 'session_hours', unallocated: { usd: 0, brl: 0 }, excluded: { usd: 3, brl: 15.6 },
    });
    expect(out.tenants[0]).toMatchObject({
      shared: { usd: 0, brl: 0 }, connectedShared: null, projectedShared: null, ai: { usd: 1.5, brl: 7.8 }, total: { usd: 1.5, brl: 7.8 },
    });
  });

  it('cursor do mês aberto não vale depois do fechamento: 400', async () => {
    const rows = Array.from({ length: INFRA_COST_TENANTS_PAGE_SIZE + 1 }, (_, i) => openRow(`t${i}`));
    const open = useCase({ reports: reports({ pageOpenMonth: vi.fn(async () => ({ rows, aiUsage: [] })) }) });
    const { nextCursor } = await open.uc.execute({ month: '2026-10' });
    const r = reports();
    const { uc } = useCase({ reports: r, closed: closedSummary(null) });
    await expect(uc.execute({ month: '2026-10', cursor: nextCursor! })).rejects.toMatchObject({ code: 'INFRA_COST_CURSOR_INVALID' });
    expect(r.pageClosedMonth).not.toHaveBeenCalled();
  });

  it('JSON antigo sem allocation/avisos: base contratadas, partes 0, sem cotação', async () => {
    const { uc } = useCase({ closed: closedSummary(null) });
    const out = await uc.execute({ month: '2026-10' });
    expect(out).toMatchObject({ sharedBasis: 'contracted', unallocated: { usd: 0, brl: null }, excluded: { usd: 0, brl: null }, fx: null });
  });
});

describe('GetInfraCostHistoryUseCase', () => {
  it('janela dos 12 meses anteriores ao corrente; BRL pela cotação congelada', async () => {
    const r = reports({
      listClosedMonths: vi.fn(async () => [{
        month: OCT, closingMethod: 'month_average' as const,
        fx: { rate: 5, referenceDate: new Date('2026-10-31T00:00:00Z'), source: 'sgs' as const },
        totalUsd: 120.25, totalIsPartial: true, unallocatedUsd: 0, excludedUsd: 18.25, closedAt: new Date('2026-11-01T01:00:00Z'),
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
      unallocated: { usd: 0, brl: 0 }, excluded: { usd: 18.25, brl: 91.25 },
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
