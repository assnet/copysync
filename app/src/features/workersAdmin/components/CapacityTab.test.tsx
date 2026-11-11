import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AdminWorkersPage } from '@/pages/admin/AdminWorkersPage';
import { adminWorkersService } from '@/services/adminWorkers.service';
import { opsMetricsService } from '@/services/opsMetrics.service';
import type { OpsSeriesResult } from '@/features/opsMetrics/types';
import { workersAdminStrings as t } from '../strings';
import type { WorkerCapacityCluster, WorkerCapacityPlan, WorkerCapacityView } from '../types';
import CapacityTab from './CapacityTab';

// Gráfico (SVG medido) não roda no jsdom: o teste cobre dados, estados e textos.
vi.mock('@mui/x-charts/LineChart', () => ({ LineChart: () => <div data-testid="line-chart" /> }));
vi.mock('@mui/x-charts/ChartsReferenceLine', () => ({ ChartsReferenceLine: () => null }));
vi.mock('@mui/x-charts/hooks', () => ({ useDrawingArea: () => ({}), useYScale: () => () => 0 }));

const c = t.capacity;
const ch = (contracted: number, connected: number, unlimitedTenants = 0) => ({ contracted, unlimitedTenants, created: connected, connected });

const PLANS: WorkerCapacityPlan[] = [
  { planSlug: 'COPYSYNC_LITE', tenants: 10, whatsapp: ch(20, 12), telegram: ch(0, 0) },
  { planSlug: 'COPYSYNC_MAX', tenants: 2, whatsapp: ch(0, 7, 2), telegram: ch(4, 1) },
  { planSlug: 'COPYSYNC_PRO', tenants: 0, whatsapp: ch(0, 0), telegram: ch(0, 0) },
];

const CLUSTER: WorkerCapacityCluster = {
  capacity: 80, connected: 30, occupancyPct: 37.5, headroom: 50, requiredReplicas: 1, mbPerSession: 12.4,
  suggestedMaxSessions: 57, memoryLimitMb: 1024, sampledAt: '2026-11-11T10:00:00.000Z',
};

const view = (cluster: Partial<WorkerCapacityCluster> = {}, over: Partial<WorkerCapacityView> = {}): WorkerCapacityView => ({
  plans: PLANS, cluster: { ...CLUSTER, ...cluster }, settings: { maxSessionsPerWorker: 40, alertOccupancyRatio: 0.8 }, enforced: true, ...over,
});

const now = Date.now();
const SERIES: OpsSeriesResult = {
  window: { from: new Date(now - 7 * 864e5).toISOString(), to: new Date(now).toISOString() },
  bucketMinutes: 60,
  series: ['sessions_connected', 'sessions_capacity'].map((metric, k) => ({
    resource: 'cluster', kind: 'other' as const, metric,
    points: [2, 1].map((h) => ({ at: new Date(now - h * 36e5).toISOString(), avg: k ? 80 : 30, min: 0, max: 0 })),
  })),
};

function mock(capacity: WorkerCapacityView | Error, series: OpsSeriesResult | Error = SERIES) {
  vi.spyOn(adminWorkersService, 'getCapacity').mockImplementation(async () => {
    if (capacity instanceof Error) throw capacity;
    return capacity;
  });
  return vi.spyOn(opsMetricsService, 'series').mockImplementation(async () => {
    if (series instanceof Error) throw series;
    return series;
  });
}

afterEach(() => vi.restoreAllMocks());

const tile = (label: string) => screen.getByText(label).closest('.MuiCard-root') as HTMLElement;

describe('CapacityTab', () => {
  it('carrega os cartões do cluster e busca a série de 7 dias de sessões × capacidade', async () => {
    const series = mock(view());
    renderWithTheme(<CapacityTab />, 'dark');
    expect(await screen.findByText(c.cards.capacity.label)).toBeInTheDocument();
    expect(within(tile(c.cards.capacity.label)).getByText(c.sessions(80))).toBeInTheDocument();
    expect(within(tile(c.cards.connected.label)).getByText(c.sessions(30))).toBeInTheDocument();
    expect(within(tile(c.cards.occupancy.label)).getByText('37,5%')).toBeInTheDocument();
    expect(within(tile(c.cards.headroom.label)).getByText(c.sessions(50))).toBeInTheDocument();
    expect(within(tile(c.cards.replicas.label)).getByText(c.workers(1))).toBeInTheDocument();
    expect(within(tile(c.cards.mbPerSession.label)).getByText(c.mb('12,4'))).toBeInTheDocument();
    expect(within(tile(c.cards.suggested.label)).getByText(c.sessions(57))).toBeInTheDocument();
    // "Conectadas" deixa claro que é contagem do banco.
    expect(c.cards.connected.label).toMatch(/banco/);
    expect(series).toHaveBeenCalledWith(['sessions_connected', 'sessions_capacity'], expect.objectContaining({ from: expect.any(String) }));
    expect(await screen.findByTestId('line-chart')).toBeInTheDocument();
  });

  it('sem amostra: "sem amostra" no lugar dos números, nunca 0', async () => {
    mock(view({ sampledAt: null, capacity: 0, connected: 0, occupancyPct: 0, headroom: 0, mbPerSession: null, suggestedMaxSessions: null }));
    renderWithTheme(<CapacityTab />);
    expect(await screen.findByText(c.noSampleNotice)).toBeInTheDocument();
    for (const k of ['capacity', 'connected', 'occupancy', 'headroom', 'replicas', 'mbPerSession', 'suggested'] as const) {
      expect(within(tile(c.cards[k].label)).getByText(c.noSample)).toBeInTheDocument();
    }
    expect(screen.queryByText(c.sessions(0))).not.toBeInTheDocument();
    // Projeção sem folga medida vira "—".
    const lite = screen.getByText('LITE').closest('tr')!;
    expect(within(lite).getByLabelText(c.plans.fitNoSample)).toHaveTextContent('—');
  });

  it('amostra velha (stale): avisa há quantos minutos e que o coletor pode estar parado', async () => {
    mock(view({ stale: true, sampledAt: new Date(Date.now() - 15 * 60_000 - 5_000).toISOString() }));
    renderWithTheme(<CapacityTab />);
    expect(await screen.findByText(c.stale(15))).toBeInTheDocument();
  });

  it('amostra recente não mostra o aviso de coletor parado', async () => {
    mock(view({ stale: false }));
    renderWithTheme(<CapacityTab />);
    await screen.findByText(c.cards.capacity.label);
    expect(screen.queryByText(/coletor pode estar parado/)).not.toBeInTheDocument();
  });

  it('ajuda da capacidade muda com a adoção (soma dos tetos × teto por processo com sessão)', async () => {
    const user = userEvent.setup();
    mock(view({}, { enforced: false }));
    renderWithTheme(<CapacityTab />);
    await screen.findByText(c.cards.capacity.label);
    await user.hover(within(tile(c.cards.capacity.label)).getByRole('button'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(c.cards.capacity.helpNotEnforced);
  });

  it('tabela por plano: clientes, contratadas e conectadas por canal, ilimitados à parte', async () => {
    mock(view());
    renderWithTheme(<CapacityTab />);
    const table = await screen.findByRole('table', { name: c.plans.aria });
    const max = within(table).getByText('MAX').closest('tr')!;
    const cells = within(max).getAllByRole('cell').map((td) => td.textContent);
    expect(cells.slice(0, 6)).toEqual(['MAX', '2', `0${c.plans.unlimited(2)}`, '7', '4', '1']);
    expect(within(table).getByText('PRO')).toBeInTheDocument();
  });

  it('projeção "cabem mais N clientes"; ilimitado e sem cliente → "—"', async () => {
    mock(view());
    renderWithTheme(<CapacityTab />);
    const table = await screen.findByRole('table', { name: c.plans.aria });
    // LITE: 20 contratadas ÷ 10 = 2 por cliente; folga 50 → 25.
    expect(within(within(table).getByText('LITE').closest('tr')!).getByText(c.plans.fit(25))).toBeInTheDocument();
    expect(within(within(table).getByText('MAX').closest('tr')!).getByLabelText(c.plans.fitUnlimited)).toHaveTextContent('—');
    expect(within(within(table).getByText('PRO').closest('tr')!).getByLabelText(c.plans.fitNoTenants)).toHaveTextContent('—');
  });

  it('erro da série não derruba a aba e tem tentar de novo', async () => {
    const user = userEvent.setup();
    const series = mock(view(), new Error('500'));
    renderWithTheme(<CapacityTab />);
    expect(await screen.findByText(c.cards.capacity.label)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: c.plans.aria })).toBeInTheDocument();
    const retry = await screen.findByRole('button', { name: /tentar/i });
    series.mockResolvedValue(SERIES);
    await user.click(retry);
    expect(await screen.findByTestId('line-chart')).toBeInTheDocument();
  });

  it('erro da capacidade mostra alerta; a série continua', async () => {
    mock(new Error('500'));
    renderWithTheme(<CapacityTab />);
    expect(await screen.findByText(c.errors.loadFailed)).toBeInTheDocument();
    expect(await screen.findByTestId('line-chart')).toBeInTheDocument();
  });

  it('rota /admin/workers/capacity ativa a aba Capacidade (chunk lazy)', async () => {
    mock(view());
    renderWithTheme(<MemoryRouter initialEntries={['/admin/workers/capacity']}><AdminWorkersPage /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: t.tabs.capacity })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(c.cards.connected.label)).toBeInTheDocument();
    expect(screen.getByText(c.subtitle)).toBeInTheDocument();
  });
});
