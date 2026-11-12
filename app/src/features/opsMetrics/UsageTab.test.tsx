import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AdminWorkersPage } from '@/pages/admin/AdminWorkersPage';
import { adminWorkersService } from '@/services/adminWorkers.service';
import { opsMetricsService } from '@/services/opsMetrics.service';
import { workersAdminStrings } from '@/features/workersAdmin/strings';
import { opsMetricsStrings as t } from './strings';
import type { OpsLatest, OpsSeries, OpsSeriesResult } from './types';

// Gráficos (SVG medido) não rodam no jsdom: o teste cobre dados, estados e textos.
vi.mock('@mui/x-charts/LineChart', () => ({ LineChart: () => <div data-testid="line-chart" /> }));
vi.mock('@mui/x-charts/BarChart', () => ({ BarChart: () => <div data-testid="bar-chart" /> }));
vi.mock('@mui/x-charts/SparkLineChart', () => ({ SparkLineChart: () => <div data-testid="spark" /> }));
vi.mock('@mui/x-charts/ChartsReferenceLine', () => ({ ChartsReferenceLine: () => null }));
vi.mock('@mui/x-charts/hooks', () => ({ useDrawingArea: () => ({}), useYScale: () => () => 0 }));

const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
const THRESHOLDS = { memoryPct: 80, cpuPct: 80, idleInTransaction: 3, eventLoopP99Ms: 200 };

const pts = (vals: number[]) => vals.map((v, i) => ({ at: iso((vals.length - i) * 15), avg: v, min: v - 1, max: v + 1 }));
const s = (kind: OpsSeries['kind'], resource: string, metric: string, vals: number[]): OpsSeries =>
  ({ kind, resource, metric, points: pts(vals) });
const result = (series: OpsSeries[]): OpsSeriesResult => ({ window: { from: iso(1440), to: iso(0) }, bucketMinutes: 15, series });

const FULL_LATEST: OpsLatest = {
  latest: [
    { resource: 'srv-1', kind: 'api', metric: 'memory_pct', value: 62, at: iso(2) },
    { resource: 'srv-1', kind: 'api', metric: 'cpu_pct', value: 34, at: iso(2) },
    { resource: 'dpg-1', kind: 'postgres', metric: 'memory_pct', value: 81, at: iso(2) },
    { resource: 'dpg-1', kind: 'postgres', metric: 'cpu_pct', value: 12, at: iso(2) },
    { resource: 'db', kind: 'postgres', metric: 'db_connections', value: 18, at: iso(2) },
    { resource: 'db', kind: 'postgres', metric: 'db_idle_in_transaction', value: 1, at: iso(2) },
    { resource: 'db', kind: 'postgres', metric: 'db_cache_hit_pct', value: 99.6, at: iso(2) },
  ],
  thresholds: THRESHOLDS,
  topQueries: [
    { queryid: '-4721938475610293', shape: 'SELECT * FROM "messages" WHERE "tenant_id" = $1', totalMs: 252_000, meanMs: 3, calls: 9, at: iso(2) },
  ],
  samplerActive: true,
  workers: [],
};

function mockAll(latest: OpsLatest | Error, series: (metrics: string[]) => OpsSeriesResult | Error) {
  vi.spyOn(adminWorkersService, 'list').mockResolvedValue({
    workers: [], totals: { workers: 0, sessions: 0, pendingLogins: 0, maxSessions: 0 }, awaiting: 0,
  });
  vi.spyOn(opsMetricsService, 'latest').mockImplementation(async () => {
    if (latest instanceof Error) throw latest;
    return latest;
  });
  vi.spyOn(opsMetricsService, 'series').mockImplementation(async (metrics) => {
    const r = series(metrics);
    if (r instanceof Error) throw r;
    return r;
  });
}

const fullSeries = (metrics: string[]) => {
  if (metrics.includes('cpu_pct')) {
    return result([
      s('api', 'srv-1', 'cpu_pct', [20, 34]), s('postgres', 'dpg-1', 'cpu_pct', [10, 12]),
      s('api', 'srv-1', 'memory_pct', [60, 62]), s('postgres', 'dpg-1', 'memory_pct', [80, 81]),
    ]);
  }
  if (metrics.includes('db_connections')) {
    return result([
      s('postgres', 'db', 'db_connections', [17, 18]), s('postgres', 'db', 'db_active', [3, 4]),
      s('postgres', 'db', 'db_idle', [13, 13]), s('postgres', 'db', 'db_idle_in_transaction', [1, 1]),
      s('postgres', 'db', 'db_cache_hit_pct', [99.5, 99.6]), s('postgres', 'db', 'db_xact_commit', [1000, 1600]),
      s('postgres', 'db', 'db_deadlocks', [0, 0]),
    ]);
  }
  return result([]);
};

function renderUsage(mode: 'light' | 'dark' = 'light') {
  return renderWithTheme(
    <MemoryRouter initialEntries={['/admin/workers/usage']}><AdminWorkersPage /></MemoryRouter>,
    mode,
  );
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('Aba Consumo', () => {
  it('abas: Consumo ativa pela URL; KPIs com status e consultas', async () => {
    mockAll(FULL_LATEST, fullSeries);
    renderUsage();
    expect(screen.getByRole('tab', { name: workersAdminStrings.tabs.usage })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(t.kpi.ramApi)).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText(t.kpi.ofMb(1270, 2048))).toBeInTheDocument();
    expect(screen.getByText('99,6%')).toBeInTheDocument();
    expect(screen.getByText(t.kpi.idleInTx(1))).toBeInTheDocument();
    // RAM do Postgres 81% ≥ 80 → acima do limite
    expect(screen.getByText(t.status.critical)).toBeInTheDocument();
    expect(screen.getByText(t.header.collecting)).toBeInTheDocument();
    expect(screen.getByText('4 min 12 s')).toBeInTheDocument();
    expect(screen.getByText(t.workers.adoptionOff)).toBeInTheDocument();
    expect(screen.getAllByTestId('line-chart').length).toBeGreaterThan(0);
  });

  it('filtro de recurso esconde KPIs do outro recurso e persiste por aba', async () => {
    mockAll(FULL_LATEST, fullSeries);
    renderUsage('dark');
    await screen.findByText(t.kpi.ramApi);
    await userEvent.click(screen.getByRole('button', { name: t.filters.resources.postgres }));
    expect(screen.queryByText(t.kpi.ramApi)).not.toBeInTheDocument();
    expect(screen.getByText(t.kpi.ramDb)).toBeInTheDocument();
    expect(sessionStorage.getItem('ui.workers.usage.filters')).toContain('postgres');
  });

  it('"Ver tabela" troca o gráfico pela tabela equivalente', async () => {
    mockAll(FULL_LATEST, fullSeries);
    renderUsage();
    await screen.findByText(t.kpi.ramApi);
    const [toggle] = screen.getAllByRole('button', { name: t.charts.showTable });
    await userEvent.click(toggle);
    const table = screen.getByRole('table', { name: t.charts.cpu });
    expect(within(table).getByText(t.charts.tableCols.avg)).toBeInTheDocument();
  });

  it('coleta desligada sem amostras: só instruções', async () => {
    mockAll({ ...FULL_LATEST, latest: [], topQueries: [], samplerActive: false }, () => result([]));
    renderUsage();
    expect(await screen.findByText(t.off.title)).toBeInTheDocument();
    expect(screen.getByText('OPS_METRICS_SAMPLER_ENABLED=true')).toBeInTheDocument();
    expect(screen.queryByText(t.kpi.ramApi)).not.toBeInTheDocument();
    expect(screen.getByText(t.header.notCollecting)).toBeInTheDocument();
  });

  it('coleta parada com amostras antigas: aviso e dados', async () => {
    mockAll({ ...FULL_LATEST, latest: [], samplerActive: false }, fullSeries);
    renderUsage();
    expect(await screen.findByText(/A coleta está parada/)).toBeInTheDocument();
    expect(screen.getByText(t.kpi.ramApi)).toBeInTheDocument();
  });

  it('sem dados da Render: CPU e memória com instrução específica', async () => {
    mockAll(FULL_LATEST, (m) => (m.includes('cpu_pct') ? result([]) : fullSeries(m)));
    renderUsage();
    expect(await screen.findAllByText(t.charts.renderMissing)).toHaveLength(2);
  });

  it('falha total: erro com "tentar de novo"', async () => {
    mockAll(new Error('x'), () => new Error('x'));
    renderUsage();
    expect(await screen.findByText(t.loadFailed)).toBeInTheDocument();
    vi.spyOn(opsMetricsService, 'latest').mockResolvedValue(FULL_LATEST);
    vi.spyOn(opsMetricsService, 'series').mockImplementation(async (m) => fullSeries(m));
    await userEvent.click(screen.getByRole('button', { name: t.retry }));
    expect(await screen.findByText(t.kpi.ramApi)).toBeInTheDocument();
  });

  it('erro só do banco: cartões do banco com erro, servidores normais', async () => {
    mockAll(FULL_LATEST, (m) => (m.includes('db_connections') ? new Error('db') : fullSeries(m)));
    renderUsage();
    expect(await screen.findAllByText(t.charts.error)).toHaveLength(4);
    expect(screen.getByText(t.kpi.cpuApi)).toBeInTheDocument();
  });

  it('com batimento de worker: cartões por worker', async () => {
    mockAll(
      { ...FULL_LATEST, workers: [{ workerId: 'w-1', role: 'worker', sessions: 1, pendingLogins: 0, maxSessions: 40, rssMb: 300, cpuPct: 5, eventLoopP99Ms: 20, seenAt: iso(0) }] },
      (m) => (m.includes('rss_mb')
        ? result([s('worker', 'w-1', 'rss_mb', [290, 300]), s('worker', 'w-1', 'event_loop_p99_ms', [12, 20])])
        : fullSeries(m)),
    );
    renderUsage();
    expect(await screen.findByText(t.charts.workerMemory)).toBeInTheDocument();
    expect(screen.queryByText(t.workers.adoptionOff)).not.toBeInTheDocument();
  });

  it('Conexões sem ociosas em transação: status "Sem dados", nunca "Ok"', async () => {
    mockAll(
      { ...FULL_LATEST, latest: FULL_LATEST.latest.filter((v) => v.metric !== 'db_idle_in_transaction') },
      (m) => (m.includes('db_connections')
        ? result([s('postgres', 'db', 'db_connections', [17, 18])])
        : fullSeries(m)),
    );
    renderUsage();
    const label = await screen.findByText(t.kpi.connections);
    const tile = label.closest('.MuiCard-root') as HTMLElement;
    expect(within(tile).getByText('18')).toBeInTheDocument();
    expect(within(tile).getByText(t.status.noData)).toBeInTheDocument();
    expect(within(tile).queryByText(t.status.ok)).not.toBeInTheDocument();
  });

  it('filtros inválidos no sessionStorage caem no padrão e a aba carrega', async () => {
    sessionStorage.setItem('ui.workers.usage.filters', JSON.stringify({ v: 1, d: { range: '2y', resource: 'x', autoRefresh: 1 } }));
    mockAll(FULL_LATEST, fullSeries);
    renderUsage();
    expect(await screen.findByText(t.kpi.ramApi)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.filters.ranges['24h'] })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: t.filters.resources.all })).toHaveAttribute('aria-pressed', 'true');
    const [, window] = vi.mocked(opsMetricsService.series).mock.calls[0];
    expect(Date.parse(window.to) - Date.parse(window.from)).toBe(24 * 60 * 60_000);
  });

  describe('worker separado da API', () => {
    const WORKER_LATEST: OpsLatest = {
      ...FULL_LATEST,
      latest: [
        ...FULL_LATEST.latest,
        { resource: 'srv-wk-a1', kind: 'worker_service', metric: 'memory_pct', value: 45, at: iso(2) },
        { resource: 'srv-wk-b2', kind: 'worker_service', metric: 'memory_pct', value: 73, at: iso(2) },
        { resource: 'srv-wk-a1', kind: 'worker_service', metric: 'cpu_pct', value: 21, at: iso(2) },
        { resource: 'srv-wk-b2', kind: 'worker_service', metric: 'cpu_pct', value: 9, at: iso(2) },
      ],
    };
    const workerSeries = (m: string[]) => {
      const base = fullSeries(m);
      if (!m.includes('cpu_pct')) return base;
      return result([
        ...base.series,
        s('worker_service', 'srv-wk-a1', 'cpu_pct', [20, 21]), s('worker_service', 'srv-wk-b2', 'cpu_pct', [8, 9]),
        s('worker_service', 'srv-wk-a1', 'memory_pct', [44, 45]), s('worker_service', 'srv-wk-b2', 'memory_pct', [70, 73]),
      ]);
    };

    it('cartões do Worker com a pior instância; API não mistura o worker', async () => {
      mockAll(WORKER_LATEST, workerSeries);
      renderUsage();
      const ram = (await screen.findByText(t.kpi.ramWorker)).closest('.MuiCard-root') as HTMLElement;
      expect(within(ram).getByText('73%')).toBeInTheDocument();
      expect(within(ram).getByText(t.kpi.worstOf(2))).toBeInTheDocument();
      const cpu = screen.getByText(t.kpi.cpuWorker).closest('.MuiCard-root') as HTMLElement;
      expect(within(cpu).getByText('21%')).toBeInTheDocument();
      const ramApi = screen.getByText(t.kpi.ramApi).closest('.MuiCard-root') as HTMLElement;
      expect(within(ramApi).getByText('62%')).toBeInTheDocument();
    });

    it('tabela de Servidores separa API e Worker', async () => {
      mockAll(WORKER_LATEST, workerSeries);
      renderUsage();
      await screen.findByText(t.kpi.ramWorker);
      const [toggle] = screen.getAllByRole('button', { name: t.charts.showTable });
      await userEvent.click(toggle);
      const table = screen.getByRole('table', { name: t.charts.cpu });
      expect(within(table).getAllByText(t.charts.series.api).length).toBeGreaterThan(0);
      expect(within(table).getAllByText(t.charts.series.workerService).length).toBeGreaterThan(0);
      // Valor da série do worker (pior instância no último balde: 21%) na linha "Worker"
      const workerRow = within(table).getAllByRole('row').find((r) => within(r).queryByText(t.charts.series.workerService)
        && within(r).queryByText('21%'));
      expect(workerRow).toBeDefined();
    });

    it('filtro "Worker" mostra só os cartões do worker (tema escuro)', async () => {
      mockAll(WORKER_LATEST, workerSeries);
      renderUsage('dark');
      await screen.findByText(t.kpi.ramWorker);
      await userEvent.click(screen.getByRole('button', { name: t.filters.resources.worker_service }));
      expect(screen.queryByText(t.kpi.ramApi)).not.toBeInTheDocument();
      expect(screen.queryByText(t.kpi.ramDb)).not.toBeInTheDocument();
      expect(screen.getByText(t.kpi.cpuWorker)).toBeInTheDocument();
      expect(sessionStorage.getItem('ui.workers.usage.filters')).toContain('worker_service');
    });

    it('instância antiga (trocada por deploy) não entra no pior valor nem na contagem', async () => {
      mockAll({
        ...WORKER_LATEST,
        latest: [...WORKER_LATEST.latest, { resource: 'srv-wk-old', kind: 'worker_service', metric: 'memory_pct', value: 97, at: iso(12) }],
      }, workerSeries);
      renderUsage();
      const ram = (await screen.findByText(t.kpi.ramWorker)).closest('.MuiCard-root') as HTMLElement;
      expect(within(ram).getByText('73%')).toBeInTheDocument();
      expect(within(ram).getByText(t.kpi.worstOf(2))).toBeInTheDocument();
    });

    it('sem amostra do worker (API sem o id do serviço): sem cartões de Worker', async () => {
      mockAll(FULL_LATEST, fullSeries);
      renderUsage();
      await screen.findByText(t.kpi.ramApi);
      expect(screen.queryByText(t.kpi.ramWorker)).not.toBeInTheDocument();
    });
  });
});
