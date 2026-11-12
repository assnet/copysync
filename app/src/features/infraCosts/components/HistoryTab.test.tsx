import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AdminCostsPage } from '@/pages/admin/AdminCostsPage';
import { adminCostsService } from '@/services/adminCosts.service';
import { historyChronological, historyPlanKeys, monthLabel } from '../rules';
import { infraCostsStrings as S } from '../strings';
import type { InfraCostHistory, InfraCostHistoryMonthView, InfraMoney } from '../types';
import HistoryTab from './HistoryTab';

const chartProps = vi.hoisted(() => ({ last: null as null | { series: { id: string; color: string; stack: string; data: number[] }[] } }));
vi.mock('@mui/x-charts/BarChart', () => ({
  BarChart: (props: typeof chartProps.last) => { chartProps.last = props; return <div data-testid="bar-chart" />; },
}));

const h = S.history;
const m = (usd: number, brl: number | null = usd * 5): InfraMoney => ({ usd, brl });

function month(id: string, over: Partial<InfraCostHistoryMonthView> = {}): InfraCostHistoryMonthView {
  return {
    month: id, closedAt: `${id}-28T01:00:00.000Z`, closingMethod: 'last_business_day',
    fx: { rate: 5.1, referenceDate: `${id}-27`, source: 'ptax' }, total: m(120), totalIsPartial: false,
    unallocated: m(0), excluded: m(0),
    plans: [
      { planSlug: 'COPYSYNC_MAX', tenants: 1, shared: m(50), ai: m(0), total: m(50) },
      { planSlug: 'COPYSYNC_LITE', tenants: 4, shared: m(60), ai: m(5), total: m(65) },
      { planSlug: null, tenants: 0, shared: m(5), ai: m(0), total: m(5) },
    ],
    ...over,
  };
}

const history = (months: InfraCostHistoryMonthView[]): InfraCostHistory => ({ from: '2025-11', to: '2026-10', months });

const renderTab = (mode: 'light' | 'dark' = 'light') => renderWithTheme(<MemoryRouter><HistoryTab /></MemoryRouter>, mode);

beforeEach(() => vi.restoreAllMocks());

describe('HistoryTab', () => {
  it.each(['light', 'dark'] as const)('tabela por plano na ordem do catálogo, congelada e parcial (%s)', async (mode) => {
    vi.spyOn(adminCostsService, 'getHistory').mockResolvedValue(history([month('2026-10', { totalIsPartial: true }), month('2026-09')]));
    renderTab(mode);
    const table = await screen.findByRole('table', { name: h.tableAria });
    const headers = within(table).getAllByRole('columnheader').map((c) => c.textContent);
    expect(headers).toEqual([h.columns.month, 'LITE', 'MAX', S.summary.plans.noPlan, h.columns.excluded, h.columns.total, h.columns.fx]);
    expect(within(table).getByText(monthLabel('2026-10'))).toBeInTheDocument();
    expect(within(table).getAllByText(h.frozen)).toHaveLength(2);
    expect(within(table).getAllByText(h.partial)).toHaveLength(1);
    expect(await screen.findByRole('figure', { name: h.chartAria(monthLabel('2026-09'), monthLabel('2026-10')) })).toBeInTheDocument();
    // Empilhado por plano, cronológico; cor pelo plano e "sem plano" no neutro.
    const series = chartProps.last!.series;
    expect(series.map((x) => x.id)).toEqual(['COPYSYNC_LITE', 'COPYSYNC_MAX', '__none']);
    expect(new Set(series.map((x) => x.stack))).toEqual(new Set(['total']));
    expect(series[0].data).toEqual([65, 65]);
    expect(new Set(series.map((x) => x.color)).size).toBe(3);
  });

  it('fora do rateio e não rateado em colunas: a soma fecha com o total', async () => {
    vi.spyOn(adminCostsService, 'getHistory').mockResolvedValue(history([
      month('2026-10', { total: m(130), unallocated: m(4), excluded: m(6) }),
    ]));
    renderTab();
    const table = await screen.findByRole('table', { name: h.tableAria });
    const headers = within(table).getAllByRole('columnheader').map((c) => c.textContent);
    expect(headers).toContain(h.columns.unallocated);
    expect(headers).toContain(h.columns.excluded);
    expect(within(table).getByText('US$ 6,00')).toBeInTheDocument();
    expect(within(table).getByText('US$ 4,00')).toBeInTheDocument();
  });

  it('sem mês fechado: estado vazio', async () => {
    vi.spyOn(adminCostsService, 'getHistory').mockResolvedValue(history([]));
    renderTab();
    expect(await screen.findByText(h.empty)).toBeInTheDocument();
  });

  it('erro com tentar de novo', async () => {
    const spy = vi.spyOn(adminCostsService, 'getHistory').mockRejectedValueOnce(new Error('x'));
    spy.mockResolvedValueOnce(history([month('2026-10')]));
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: S.retry }));
    expect(await screen.findByRole('table', { name: h.tableAria })).toBeInTheDocument();
  });

  it('aba em /admin/costs/history', async () => {
    vi.spyOn(adminCostsService, 'getHistory').mockResolvedValue(history([month('2026-10')]));
    renderWithTheme(<MemoryRouter initialEntries={['/admin/costs/history']}><AdminCostsPage /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: S.tabs.history })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('table', { name: h.tableAria })).toBeInTheDocument();
  });
});

describe('regras do histórico', () => {
  it('ordem cronológica e planos do catálogo antes de "sem plano"', () => {
    const list = [month('2026-10'), month('2026-08'), month('2026-09')];
    expect(historyChronological(list).map((x) => x.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(historyPlanKeys(list)).toEqual(['COPYSYNC_LITE', 'COPYSYNC_MAX', null]);
  });
});
