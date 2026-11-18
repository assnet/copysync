import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { adminUsageService } from '@/services/adminUsage.service';
import { DEFAULT_USAGE_FILTERS, USAGE_KINDS, coverageReasonText, formatInteger, formatReach } from '../rules';
import { featureUsageStrings as S } from '../strings';
import { detailFixture, summaryFixture } from '../testFixtures';
import { UsagePageContext, type UsagePageValue } from '../hooks/useUsagePage';
import type { UsageFeatureItem, UsageFeatureKey, UsageFilters, UsageSummary } from '../types';
import OverviewTab from './OverviewTab';

// O x-charts não carrega no jsdom (ESM do @mui/material/styles): o gráfico vira um marcador; os números estão nos rótulos e nas tabelas.
const chartProps = vi.hoisted(() => [] as Array<{ yAxis?: Array<{ tickMinStep?: number; min?: number }> }>);
vi.mock('@mui/x-charts/LineChart', () => ({
  LineChart: (p: { yAxis?: Array<{ tickMinStep?: number; min?: number }> }) => { chartProps.push(p); return <div data-testid="line-chart" />; },
}));
vi.mock('@/services/adminUsage.service', () => ({
  adminUsageService: { getSummary: vi.fn(), getDetail: vi.fn(), getTenants: vi.fn() },
}));
const getDetail = vi.mocked(adminUsageService.getDetail);

/** Todos os tipos: a fixture tem um recurso de audiência (`link_rotation_click`, parcial com dois motivos). */
const ALL_KINDS: UsageFilters = { ...DEFAULT_USAGE_FILTERS, kinds: [...USAGE_KINDS] };

function renderTab(summary: UsageSummary, opts: { filters?: UsageFilters; mode?: 'light' | 'dark'; setFilters?: (f: UsageFilters) => void } = {}) {
  const value: UsagePageValue = {
    filters: opts.filters ?? ALL_KINDS,
    setFilters: opts.setFilters ?? vi.fn(),
    query: { from: summary.range.from, to: summary.range.to },
    maxDays: 90,
    summary: { data: summary, loading: false, error: false, slow: false, unavailable: false, ready: true, reload: vi.fn() },
    refreshKey: 0,
    reportMaxDays: vi.fn(),
    featureKey: null,
    accountNames: { remember: vi.fn(), nameOf: () => undefined },
    screensView: 'chart',
    setScreensView: vi.fn(),
  };
  return renderWithTheme(
    <MemoryRouter>
      <UsagePageContext.Provider value={value}>
        <OverviewTab />
      </UsagePageContext.Provider>
    </MemoryRouter>,
    opts.mode,
  );
}

const ranking = async () => screen.findByRole('region', { name: S.ranking.title });
const label = (key: UsageFeatureKey) => S.features[key].label;

beforeEach(() => window.sessionStorage.clear());
afterEach(() => window.sessionStorage.clear());

describe('OverviewTab', () => {
  it('eixo Y da tendência só marca inteiros (sem "0, 0, 0, 1, 1" com valores pequenos)', async () => {
    chartProps.length = 0;
    renderTab(summaryFixture());
    await screen.findByTestId('line-chart');
    const axes = chartProps.flatMap((p) => p.yAxis ?? []);
    expect(axes.length).toBeGreaterThan(0);
    for (const axis of axes) expect(axis).toMatchObject({ min: 0, tickMinStep: 1 });
  });

  it('ranking ordena por contas por padrão e cada nome abre o detalhe', async () => {
    renderTab(summaryFixture());
    const region = await ranking();
    const links = within(region).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/admin/usage/features/offer_generator',
      '/admin/usage/features/offer_hunter',
      '/admin/usage/features/link_rotation_click',
      '/admin/usage/features/saver_extraction',
      '/admin/usage/features/telegram_session',
    ]);
    expect(within(region).getByRole('button', { name: S.filters.sorts.tenants })).toHaveAttribute('aria-pressed', 'true');
  });

  it('trocar a ordenação grava nos filtros (persistidos pela página)', async () => {
    const user = userEvent.setup();
    const setFilters = vi.fn();
    renderTab(summaryFixture(), { setFilters });
    const region = await ranking();
    await user.click(within(region).getByRole('button', { name: S.filters.sorts.uses }));
    expect(setFilters).toHaveBeenCalledWith(expect.objectContaining({ sort: 'uses' }));
  });

  it('o Caçador mostra os dois rótulos de tipo', async () => {
    renderTab(summaryFixture());
    const region = await ranking();
    const row = within(region).getByRole('link', { name: S.actions.openDetail(label('offer_hunter')) }).closest('li') as HTMLElement;
    expect(within(row).getByText(S.kindChip.ACTION)).toBeInTheDocument();
    expect(within(row).getByText(S.kindChip.AUTOMATIC)).toBeInTheDocument();
  });

  it('recurso parcial mostra o aviso com um texto por código e o "dados desde" do firstDataDay', async () => {
    const user = userEvent.setup();
    const summary = summaryFixture();
    const partial = summary.features.find((f) => f.key === 'link_rotation_click') as UsageFeatureItem;
    renderTab(summary);
    const region = await ranking();
    const chips = within(region).getAllByLabelText(S.coverage.partialAria(label('link_rotation_click')));
    expect(chips).toHaveLength(1);
    await user.hover(chips[0]);
    const tip = await screen.findByRole('tooltip');
    for (const code of partial.coverageReasons) expect(within(tip).getByText(coverageReasonText(code, partial.retentionDays))).toBeInTheDocument();
    expect(partial.coverageReasons).toHaveLength(2);
    expect(within(tip).getByText(S.coverage.dataSince('01/07/2026'))).toBeInTheDocument();
  });

  it('a tabela alternativa tem os mesmos números das barras', async () => {
    const user = userEvent.setup();
    const summary = summaryFixture();
    renderTab(summary);
    const region = await ranking();
    const gen = summary.features.find((f) => f.key === 'offer_generator') as UsageFeatureItem;
    expect(within(region).getByText(S.ranking.barValue(String(gen.activeTenants), String(gen.uses)))).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: S.actions.showTable }));
    const table = within(region).getByRole('table', { name: S.ranking.tableAria });
    const row = within(table).getByRole('link', { name: S.actions.openDetail(label('offer_generator')) }).closest('tr') as HTMLElement;
    expect(within(row).getByText(formatInteger(gen.activeTenants))).toBeInTheDocument();
    expect(within(row).getByText(formatInteger(gen.uses))).toBeInTheDocument();
    expect(within(row).getByText(formatReach(gen.reach))).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(summary.features.length + 1);
  });

  it('P3: tabela com adoção, recorrência e retenção; adoção null mostra "—" com explicação', async () => {
    const user = userEvent.setup();
    renderTab(summaryFixture());
    const region = await ranking();
    // Na barra só a adoção, com o denominador na dica.
    expect(within(region).getByLabelText(new RegExp(S.retention.adoptionOf('8', '12')))).toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: S.actions.showTable }));
    const table = within(region).getByRole('table', { name: S.ranking.tableAria });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining([S.ranking.columns.adoption, S.ranking.columns.recurring, S.ranking.columns.retention]));
    const gen = within(table).getByRole('link', { name: S.actions.openDetail(label('offer_generator')) }).closest('tr') as HTMLElement;
    expect(within(gen).getByLabelText(`${S.ranking.columns.adoption}: 67%. ${S.retention.adoptionOf('8', '12')}`)).toBeInTheDocument();
    expect(within(gen).getByLabelText(`${S.ranking.columns.recurring}: 63%. ${S.retention.recurringOf('5', '8', 3)}`)).toBeInTheDocument();
    expect(within(gen).getByLabelText(`${S.ranking.columns.retention}: 67%. ${S.retention.retainedOf('4', '6')}`)).toBeInTheDocument();
    const tg = within(table).getByRole('link', { name: S.actions.openDetail(label('telegram_session')) }).closest('tr') as HTMLElement;
    const missing = within(tg).getByLabelText(`${S.ranking.columns.adoption}: ${S.measures.noValue}. ${S.retention.noEligible}`);
    await user.hover(missing);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(S.retention.noEligible);
  });

  it('mais de 12 recursos mostra 12 barras e "ver todos" abre a tabela com todos', async () => {
    const user = userEvent.setup();
    const summary = summaryFixture();
    const base = summary.features[0];
    const keys = Object.keys(S.features) as UsageFeatureKey[];
    summary.features = keys.slice(0, 14).map((key, i) => ({ ...base, key, activeTenants: 14 - i, uses: 100 - i }));
    renderTab(summary);
    const region = await ranking();
    expect(within(region).getAllByRole('listitem')).toHaveLength(12);
    // Barra proporcional ao maior valor da ordenação (contas): 14 → 100%, 7 → 50%.
    const bars = within(region).getAllByTestId('ranking-bar');
    expect(getComputedStyle(bars[0]).width).toBe('100%');
    expect(getComputedStyle(bars[7]).width).toBe('50%');
    await user.click(within(region).getByRole('button', { name: S.actions.seeAll(14) }));
    expect(within(within(region).getByRole('table')).getAllByRole('row')).toHaveLength(15);
  });

  it('sem uso no período lista os recursos zerados; lista vazia mostra mensagem positiva', async () => {
    const view = renderTab(summaryFixture());
    const never = await screen.findByRole('region', { name: S.neverUsed.aria });
    expect(within(never).getByRole('link', { name: S.actions.openDetail(label('telegram_session')) })).toHaveAttribute('href', '/admin/usage/features/telegram_session');
    view.unmount();

    const summary = summaryFixture();
    summary.features = summary.features.filter((f) => f.activeTenants > 0);
    renderTab(summary, { mode: 'dark' });
    expect(await screen.findByText(S.neverUsed.empty)).toBeInTheDocument();
  });

  it('a tendência mostra contas ativas e, com recurso escolhido, lê a série dele e indica o período anterior', async () => {
    const user = userEvent.setup();
    const detail = detailFixture();
    getDetail.mockResolvedValue(detail);
    renderTab(summaryFixture(), { filters: { ...ALL_KINDS } });
    const trend = await screen.findByRole('region', { name: S.trend.title });
    expect(within(trend).getByText(S.trend.subtitleOverall)).toBeInTheDocument();
    expect(getDetail).not.toHaveBeenCalled();

    await user.click(within(trend).getByRole('combobox', { name: S.trend.featureSelect }));
    await user.click(await screen.findByRole('option', { name: label(detail.feature.key) }));
    await waitFor(() => expect(getDetail).toHaveBeenCalledWith(detail.feature.key, expect.any(Object), 'trend'));
    expect(await within(trend).findByText(S.trend.subtitleFeature(label(detail.feature.key)))).toBeInTheDocument();
    if (detail.feature.usesPrevious !== null) {
      expect(within(trend).getByText(S.trend.previousHint)).toBeInTheDocument();
    }
    await user.click(within(trend).getByRole('button', { name: S.actions.showTable }));
    expect(within(within(trend).getByRole('table')).getAllByRole('row')).toHaveLength(detail.series.length + 1);
  });

  it('recorte padrão (ação + automático) não mostra recurso de audiência', async () => {
    renderTab(summaryFixture(), { filters: DEFAULT_USAGE_FILTERS });
    const region = await ranking();
    expect(within(region).queryByText(label('link_rotation_click'))).toBeNull();
  });
});
