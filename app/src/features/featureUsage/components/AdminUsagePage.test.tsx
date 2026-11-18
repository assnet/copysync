import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { serviceUpdatingStrings } from '@/components/serviceUpdatingStrings';
import { AdminUsagePage } from '@/pages/admin/AdminUsagePage';
import { adminUsageService } from '@/services/adminUsage.service';
import { USAGE_FEATURE_ROUTE, USAGE_PATH, USAGE_PLANS_PATH, USAGE_SCREENS_PATH } from '../paths';
import { screensFixture } from '../testFixtures';
import { featureUsageStrings as S } from '../strings';
import { summaryFixture } from '../testFixtures';
import type { UsageSummary } from '../types';
import { forgetUsageMaxDays, rememberUsageMaxDays } from '../usageMaxDays';

// 22:00 de 17/11/2026 em Brasília: "hoje" é 17/11 mesmo já sendo 18/11 em UTC.
vi.mock('@/services/serverClock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/serverClock')>()),
  serverNow: () => Date.UTC(2026, 10, 18, 1, 0, 0),
}));

// O x-charts não carrega no jsdom (ESM do @mui/material/styles): o gráfico vira um marcador; os números estão nos rótulos e nas tabelas.
vi.mock('@mui/x-charts/LineChart', () => ({ LineChart: () => <div data-testid="line-chart" /> }));
vi.mock('@/services/adminUsage.service', () => ({
  adminUsageService: { getSummary: vi.fn(), getDetail: vi.fn(), getTenants: vi.fn(), getScreens: vi.fn() },
}));

const getSummary = vi.mocked(adminUsageService.getSummary);
const getDetail = vi.mocked(adminUsageService.getDetail);
const getScreens = vi.mocked(adminUsageService.getScreens);

function renderAt(path: string, mode: 'light' | 'dark' = 'light') {
  return renderWithTheme(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={USAGE_PATH} element={<AdminUsagePage />} />
        <Route path={USAGE_PLANS_PATH} element={<AdminUsagePage />} />
        <Route path={USAGE_SCREENS_PATH} element={<AdminUsagePage />} />
        <Route path={USAGE_FEATURE_ROUTE} element={<AdminUsagePage />} />
      </Routes>
    </MemoryRouter>,
    mode,
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  window.sessionStorage.clear();
  getSummary.mockResolvedValue(summaryFixture());
  getDetail.mockReturnValue(new Promise(() => {}));
  getScreens.mockResolvedValue(screensFixture());
});

afterEach(() => {
  window.sessionStorage.clear();
  forgetUsageMaxDays();
});

describe('AdminUsagePage', () => {
  it('aba Telas pela URL: lê as telas sem o N da recorrência e não mostra o seletor nem o CSV', async () => {
    renderAt(USAGE_SCREENS_PATH);
    expect(await screen.findByRole('figure', { name: S.screens.aria })).toBeInTheDocument();
    expect(screen.getAllByRole('tab', { name: S.tabs.screens, selected: true }).length).toBeGreaterThan(0);
    expect(getScreens).toHaveBeenCalledWith({
      from: '2026-10-19', to: '2026-11-17', granularity: 'day', kind: 'ACTION,AUTOMATIC', tenantStatus: 'ACTIVE', includeInternal: 'false',
    });
    expect(screen.queryByLabelText(S.retention.recurringDays)).toBeNull();
    expect(screen.queryByRole('button', { name: S.csv.button })).toBeNull();
  });

  it('o N da recorrência vai só ao resumo e fica salvo com os filtros', async () => {
    const user = userEvent.setup();
    renderAt(USAGE_PATH);
    await screen.findByText(S.kpis.activeTenants.value('9', '15'));
    await user.click(screen.getByLabelText(S.retention.recurringDays));
    await user.click(await screen.findByRole('option', { name: S.retention.recurringOption(5) }));
    await waitFor(() => expect(getSummary).toHaveBeenLastCalledWith(expect.objectContaining({ recurringDays: '5' })));
    expect(JSON.parse(window.sessionStorage.getItem('ui.usage.filters') ?? '{}').d.recurringDays).toBe(5);
  });

  it('abre a visão geral com os três indicadores e envia todos os filtros explícitos', async () => {
    renderAt(USAGE_PATH);
    expect(await screen.findByText(S.kpis.activeTenants.value('9', '15'))).toBeInTheDocument();
    expect(screen.getByText(S.kpis.featuresUsed.value('4', '5'))).toBeInTheDocument();
    const kpis = within(screen.getByRole('group', { name: S.kpis.aria }));
    expect(kpis.getByText('Gerador de ofertas')).toBeInTheDocument();
    expect(kpis.getByText(S.comparison.noBase)).toBeInTheDocument();
    // Não existe indicador de usos somados.
    expect(within(screen.getByRole('group', { name: S.kpis.aria })).queryByText(/^Usos$/)).toBeNull();
    expect(getSummary).toHaveBeenCalledWith({
      from: '2026-10-19', to: '2026-11-17', granularity: 'day', kind: 'ACTION,AUTOMATIC', tenantStatus: 'ACTIVE', includeInternal: 'false',
      recurringDays: '3',
    });
    expect(screen.getByText(/dados desde 02\/03\/2026/)).toBeInTheDocument();
  });

  it('abre direto a aba Por plano e o detalhe; no detalhe o resumo não é lido', async () => {
    renderAt(USAGE_PLANS_PATH);
    expect(await screen.findByRole('tab', { name: S.tabs.plans, selected: true })).toBeInTheDocument();
    getSummary.mockClear();
    renderAt('/admin/usage/features/offer_generator');
    expect(await screen.findByRole('heading', { name: 'Gerador de ofertas' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab', { name: S.tabs.overview, selected: true }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: S.actions.back })).toHaveAttribute('href', USAGE_PATH);
    expect(getSummary).not.toHaveBeenCalled();
  });

  it('filtros sobrevivem a reload (sessionStorage) e não guardam nome de conta', async () => {
    const user = userEvent.setup();
    const first = renderAt(USAGE_PATH);
    await screen.findByText(S.kpis.activeTenants.value('9', '15'));
    await user.click(screen.getByRole('button', { name: S.filters.presets['7d'] }));
    await waitFor(() => expect(window.sessionStorage.getItem('ui.usage.filters')).toContain('"7d"'));
    first.unmount();
    getSummary.mockClear();
    renderAt(USAGE_PATH);
    await waitFor(() => expect(getSummary).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-11-11', to: '2026-11-17' })));
    expect(screen.getByRole('button', { name: S.filters.presets['7d'] })).toHaveAttribute('aria-pressed', 'true');
  });

  it('mudar filtro refaz a chamada e descarta a resposta antiga', async () => {
    const user = userEvent.setup();
    const old = deferred<UsageSummary>();
    const fresh = summaryFixture();
    fresh.totals.activeTenants = 3;
    getSummary.mockReturnValueOnce(old.promise).mockResolvedValueOnce(fresh);
    renderAt(USAGE_PATH);
    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: S.filters.presets['7d'] }));
    expect(await screen.findByText(S.kpis.activeTenants.value('3', '15'))).toBeInTheDocument();
    await act(async () => { old.resolve(summaryFixture()); });
    expect(screen.getByText(S.kpis.activeTenants.value('3', '15'))).toBeInTheDocument();
    expect(screen.queryByText(S.kpis.activeTenants.value('9', '15'))).toBeNull();
  });

  it('503 de leitura lenta mostra Alert com "Tentar de novo"; outro 503 mostra o estado de atualização', async () => {
    const user = userEvent.setup();
    getSummary.mockRejectedValueOnce({ code: 'USAGE_METRICS_READ_UNAVAILABLE', status: 503, serviceUnavailable: true });
    const view = renderAt(USAGE_PATH);
    expect(await screen.findByText(S.errors.readSlow)).toBeInTheDocument();
    expect(screen.queryByText(serviceUpdatingStrings.title)).toBeNull();
    await user.click(screen.getByRole('button', { name: S.actions.retry }));
    expect(await screen.findByText(S.kpis.activeTenants.value('9', '15'))).toBeInTheDocument();
    view.unmount();

    getSummary.mockRejectedValueOnce({ status: 503, serviceUnavailable: true });
    renderAt(USAGE_PATH);
    expect(await screen.findByText(serviceUpdatingStrings.title)).toBeInTheDocument();
  });

  it('400 de período mostra o aviso com o teto de meta.maxDays e volta ao preset padrão', async () => {
    window.sessionStorage.setItem('ui.usage.filters', JSON.stringify({ v: 1, d: { preset: '90d' } }));
    getSummary.mockRejectedValueOnce({ code: 'USAGE_METRICS_RANGE_INVALID', status: 400, meta: { field: 'range', maxDays: 60 } });
    renderAt(USAGE_PATH);
    expect(await screen.findByText(S.rangeReset(60))).toBeInTheDocument();
    await waitFor(() => expect(getSummary).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-19' })));
    expect(screen.queryByText(S.errors.loadFailed)).toBeNull();
  });

  it('400 de período sem meta.maxDays usa o texto neutro', async () => {
    window.sessionStorage.setItem('ui.usage.filters', JSON.stringify({ v: 1, d: { preset: '90d' } }));
    getSummary.mockRejectedValueOnce({ code: 'USAGE_METRICS_RANGE_INVALID', status: 400, meta: { field: 'range' } });
    renderAt(USAGE_PATH);
    expect(await screen.findByText(S.rangeResetNeutral)).toBeInTheDocument();
  });

  it('filtros salvos são relidos contra o teto da última resposta quando conhecido', async () => {
    const custom = { preset: 'custom', from: '2026-06-01', to: '2026-11-10' };
    window.sessionStorage.setItem('ui.usage.filters', JSON.stringify({ v: 1, d: custom }));
    rememberUsageMaxDays(400);
    renderAt(USAGE_PATH);
    await waitFor(() => expect(getSummary).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-06-01', to: '2026-11-10' })));
  });

  it('personalizado acima do teto mostra a mensagem ao lado do campo e não chama a API', async () => {
    const user = userEvent.setup();
    renderAt(USAGE_PATH);
    await screen.findByText(S.kpis.activeTenants.value('9', '15'));
    getSummary.mockClear();
    await user.click(screen.getByRole('button', { name: S.filters.presets.custom }));
    await user.clear(screen.getByLabelText(S.filters.customFrom));
    await user.type(screen.getByLabelText(S.filters.customFrom), '2026-01-01');
    expect(screen.getByRole('button', { name: S.filters.customApply })).toBeDisabled();
    expect(screen.getByText(S.periodErrors.tooLong(90))).toBeInTheDocument();
    expect(getSummary).not.toHaveBeenCalled();
  });

  it('fonte live mostra o chip discreto; agregado diário recente não mostra aviso', async () => {
    const view = renderAt(USAGE_PATH);
    await screen.findByText(S.kpis.activeTenants.value('9', '15'));
    expect(screen.getByText(S.context.liveBadge)).toBeInTheDocument();
    view.unmount();

    getSummary.mockResolvedValue({ ...summaryFixture(), source: 'daily', freshAt: '2026-11-18T00:30:00.000Z' });
    renderAt(USAGE_PATH, 'dark');
    await screen.findByText(S.kpis.activeTenants.value('9', '15'));
    expect(screen.queryByText(S.context.liveBadge)).toBeNull();
    expect(screen.queryByText(S.context.stale('30 min'))).toBeNull();
    expect(screen.getByLabelText(S.context.dailyHint)).toBeInTheDocument();
  });

  it('agregado diário com mais de 1 h sem atualizar mostra aviso', async () => {
    getSummary.mockResolvedValue({ ...summaryFixture(), source: 'daily', freshAt: '2026-11-17T22:59:00.000Z' });
    renderAt(USAGE_PATH);
    expect(await screen.findByText(S.context.stale('2 h'))).toBeInTheDocument();
  });

  it('com range.maxDays = 400 oferece "6 meses" e "12 meses" e "12 meses" pede por semana', async () => {
    const user = userEvent.setup();
    const long = summaryFixture();
    long.range.maxDays = 400;
    getSummary.mockResolvedValue({ ...long, source: 'daily', freshAt: '2026-11-18T00:30:00.000Z' });
    renderAt(USAGE_PATH);
    await user.click(await screen.findByRole('button', { name: S.filters.presets['365d'] }));
    expect(screen.getByRole('button', { name: S.filters.presets['180d'] })).toBeInTheDocument();
    await waitFor(() => expect(getSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2025-11-18', to: '2026-11-17', granularity: 'week' }),
    ));
  });

  it('com range.maxDays = 90 não oferece os presets longos', async () => {
    renderAt(USAGE_PATH);
    await screen.findByText(S.kpis.activeTenants.value('9', '15'));
    expect(screen.queryByRole('button', { name: S.filters.presets['365d'] })).toBeNull();
  });

  it('vazio mostra EmptyState com "Limpar filtros"; renderiza no escuro', async () => {
    const empty = summaryFixture();
    empty.totals.activeTenants = 0;
    getSummary.mockResolvedValue(empty);
    renderAt(USAGE_PATH, 'dark');
    expect(await screen.findByText(S.states.emptyTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: S.actions.clearFilters })).toBeInTheDocument();
  });

  it('botão de atualizar tem Tooltip e nome acessível e refaz a leitura', async () => {
    const user = userEvent.setup();
    renderAt(USAGE_PATH);
    await screen.findByText(S.kpis.activeTenants.value('9', '15'));
    await user.click(screen.getByRole('button', { name: S.actions.refreshAria }));
    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
  });

  it('"Atualizar" com falha mantém o dado anterior e avisa que está desatualizado', async () => {
    const user = userEvent.setup();
    renderAt(USAGE_PATH);
    await screen.findByText(S.kpis.activeTenants.value('9', '15'));
    getSummary.mockRejectedValueOnce({ status: 500 });
    await user.click(screen.getByRole('button', { name: S.actions.refreshAria }));
    expect(await screen.findByText(S.errors.staleFailed)).toBeInTheDocument();
    expect(screen.getByText(S.kpis.activeTenants.value('9', '15'))).toBeInTheDocument();
    getSummary.mockRejectedValueOnce({ code: 'USAGE_METRICS_READ_UNAVAILABLE', status: 503 });
    await user.click(screen.getByRole('button', { name: S.actions.retry }));
    expect(await screen.findByText(S.errors.staleSlow)).toBeInTheDocument();
    expect(screen.getByText(S.kpis.activeTenants.value('9', '15'))).toBeInTheDocument();
  });
});
