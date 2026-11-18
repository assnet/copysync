import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { adminUsageService } from '@/services/adminUsage.service';
import { DEFAULT_USAGE_FILTERS } from '../rules';
import { featureUsageStrings as S } from '../strings';
import { screensFixture, summaryFixture } from '../testFixtures';
import { UsagePageContext, type UsagePageValue } from '../hooks/useUsagePage';
import type { UsageFilters, UsageScreensResponse } from '../types';
import ScreensTab from './ScreensTab';

vi.mock('@/services/adminUsage.service', () => ({
  adminUsageService: { getSummary: vi.fn(), getDetail: vi.fn(), getTenants: vi.fn(), getScreens: vi.fn() },
}));
const getScreens = vi.mocked(adminUsageService.getScreens);
const t = S.screens;

function renderTab(opts: { filters?: UsageFilters; mode?: 'light' | 'dark'; setFilters?: (f: UsageFilters) => void } = {}) {
  const value: UsagePageValue = {
    filters: opts.filters ?? DEFAULT_USAGE_FILTERS,
    setFilters: opts.setFilters ?? vi.fn(),
    query: { from: '2026-10-19', to: '2026-11-17' },
    maxDays: 90,
    summary: { data: summaryFixture(), loading: false, error: false, slow: false, unavailable: false, ready: true, reload: vi.fn() },
    refreshKey: 0,
    reportMaxDays: vi.fn(),
    featureKey: null,
    accountNames: { remember: vi.fn(), nameOf: () => undefined },
  };
  return renderWithTheme(
    <MemoryRouter>
      <UsagePageContext.Provider value={value}>
        <ScreensTab />
      </UsagePageContext.Provider>
    </MemoryRouter>,
    opts.mode,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  getScreens.mockReset();
});
afterEach(() => window.sessionStorage.clear());

describe('ScreensTab', () => {
  it.each(['light', 'dark'] as const)('ranking por contas que abriram, com aviso da coleta e do tipo (%s)', async (mode) => {
    getScreens.mockResolvedValue(screensFixture());
    renderTab({ mode });
    const figure = await screen.findByRole('figure', { name: t.aria });
    const rows = within(figure).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Gerador de ofertas'),
      expect.stringContaining('Dashboard'),
      expect.stringContaining(S.screens.labels['view:saver-groups']),
      expect.stringContaining('Story de Oferta'),
    ]);
    expect(within(rows[0]).getByText(t.barValue('12', '140'))).toBeInTheDocument();
    // A fixture começa a coleta depois do início do período.
    expect(screen.getByText(t.collectionPartial('19/11/2026'))).toBeInTheDocument();
    expect(screen.getByText(t.kindIgnored)).toBeInTheDocument();
    expect(getScreens).toHaveBeenCalledWith({ from: '2026-10-19', to: '2026-11-17' });
  });

  it('tabela alternativa: contas, parte do recorte, dias-conta e cruzamento com o uso do recurso', async () => {
    getScreens.mockResolvedValue(screensFixture());
    renderTab();
    await screen.findByRole('figure', { name: t.aria });
    await userEvent.click(screen.getByRole('button', { name: S.actions.showTable }));
    const table = screen.getByRole('table', { name: t.tableAria });
    const offers = within(table).getByRole('row', { name: /Gerador de ofertas/ });
    // 12 de 15 contas = 80%; 140 dias-conta; 8 contas usaram o gerador no resumo.
    expect(within(offers).getAllByRole('cell').map((c) => c.textContent)).toEqual([expect.any(String), '12', '80%', '140', '8']);
    const dashboard = within(table).getByRole('row', { name: /Dashboard/ });
    const cells = within(dashboard).getAllByRole('cell');
    expect(cells[cells.length - 1].textContent).toBe(S.measures.noValue);
  });

  it('sem nenhuma tela aberta mostra o estado vazio com limpar filtros', async () => {
    const data: UsageScreensResponse = { ...screensFixture(), firstDataDay: null };
    data.screens = data.screens.map((s) => ({ ...s, tenants: 0, tenantDays: 0 }));
    getScreens.mockResolvedValue(data);
    const setFilters = vi.fn();
    renderTab({ setFilters, filters: { ...DEFAULT_USAGE_FILTERS, product: 'AFFILIATES' } });
    expect(await screen.findByText(t.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(t.collectionNone)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: S.actions.clearFilters }));
    expect(setFilters).toHaveBeenCalledWith(expect.objectContaining({ product: 'all' }));
  });

  it('carregando mostra esqueleto; erro mostra alerta com "Tentar de novo"', async () => {
    getScreens.mockReturnValueOnce(new Promise(() => {}));
    const view = renderTab();
    expect(screen.getByRole('status', { name: t.loading })).toBeInTheDocument();
    view.unmount();
    getScreens.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 500 }));
    renderTab();
    expect(await screen.findByText(t.loadFailed)).toBeInTheDocument();
    getScreens.mockResolvedValueOnce(screensFixture());
    await userEvent.click(screen.getByRole('button', { name: S.actions.retry }));
    expect(await screen.findByRole('figure', { name: t.aria })).toBeInTheDocument();
  });

  it('leitura lenta (503 USAGE_METRICS_READ_UNAVAILABLE) tem texto próprio', async () => {
    getScreens.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503, code: 'USAGE_METRICS_READ_UNAVAILABLE' }));
    renderTab();
    expect(await screen.findByText(S.errors.readSlow)).toBeInTheDocument();
  });
});
