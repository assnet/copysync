import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { AdminCostsPage, activeCostsTab } from '@/pages/admin/AdminCostsPage';
import { adminCostsService } from '@/services/adminCosts.service';
import { infraCostsStrings as S } from '../strings';
import type { InfraCostSummary, InfraMoney } from '../types';
import { monthLabel } from '../rules';
import SummaryTab from './SummaryTab';

const s = S.summary;
const m = (usd: number, brl: number | null = usd * 5): InfraMoney => ({ usd, brl });
const norm = (t: string | null | undefined) => (t ?? '').replace(/\s/g, ' ');

function summary(over: Partial<InfraCostSummary> = {}): InfraCostSummary {
  return {
    month: '2026-11',
    basis: 'snapshot',
    generatedAt: '2026-11-12T10:00:00.000Z',
    fx: { rate: 5, referenceDate: '2026-11-11', source: 'ptax', fetchedAt: '2026-11-11T17:00:00.000Z', stale: false },
    totalIsPartial: false,
    totals: { total: m(120), fixed: m(80), variable: m(40), shared: m(110), projected: null },
    items: [
      {
        key: 'worker', label: 'Worker', category: 'compute', billing: 'per_instance', renderKey: 'worker', planLabel: 'Standard',
        plan: '1c-2g', quantity: 2, quantitySource: 'measured_now', allocation: 'shared',
        compute: m(50), storage: null, storageToConfirm: false, cost: m(50), estimated: false,
        neighbors: { lower: { plan: '0.5c-512mb', monthly: m(14), diff: m(-36) }, upper: null },
      },
      {
        key: 'postgres', label: 'Banco', category: 'database', billing: 'fixed', renderKey: 'postgres', planLabel: '',
        plan: null, quantity: 1, quantitySource: 'manual', allocation: 'shared',
        compute: m(19), storage: null, storageToConfirm: true, cost: m(19), estimated: true, neighbors: null,
      },
    ],
    workspace: {
      planLabel: 'Hobby',
      bandwidth: { included: 5, consumed: 8, source: 'manual', overage: 3, cost: m(0.45) },
      build: { included: 500, consumed: null, source: null, overage: 0, cost: m(0) },
      total: m(0.45),
    },
    perSession: {
      contracted: { sessions: 20, perSession: m(5.5), unlimitedTenants: 0 },
      connected: { sessions: 10, perSession: m(11), unallocatedSessions: 2, unallocatedCost: m(22) },
    },
    marginalPerSession: m(0.78),
    plans: [
      {
        planSlug: 'COPYSYNC_LITE', tenants: 5, contractedSessions: 10, connectedSessions: 4,
        share: m(55), costPerTenant: m(2, 10), connectedShare: m(44), connectedCostPerTenant: m(8.8, 44),
      },
      {
        planSlug: 'COPYSYNC_MAX', tenants: 1, contractedSessions: 10, connectedSessions: 6,
        share: m(55), costPerTenant: m(55), connectedShare: m(66), connectedCostPerTenant: m(66),
      },
    ],
    warnings: [{ code: 'plan_without_price', resourceKey: 'api', plan: '2c-4g' }],
    ...over,
  };
}

function mockSummary(value: InfraCostSummary | Error) {
  return vi.spyOn(adminCostsService, 'getSummary').mockImplementation(async () => {
    if (value instanceof Error) throw value;
    return value;
  });
}

const renderTab = (mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(<MemoryRouter><SummaryTab /></MemoryRouter>, mode);

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('SummaryTab', () => {
  it.each(['light', 'dark'] as const)('mostra cotação, cartões e valores em USD e BRL lado a lado (%s)', async (mode) => {
    mockSummary(summary());
    renderTab(mode);
    expect(await screen.findByText(s.monthOf(monthLabel('2026-11')))).toBeInTheDocument();
    expect(screen.getByText(S.fxSourceAttribution)).toBeInTheDocument();
    expect(screen.getByText(/cotação de 11\/11\/2026, origem: PTAX/)).toBeInTheDocument();
    const total = screen.getByText(s.cards.total.label).closest('.MuiCard-root') as HTMLElement;
    expect(norm(total.textContent)).toContain('US$ 120,00');
    expect(norm(total.textContent)).toContain('R$ 600,00');
    // Projeção só a partir da P2.
    expect(screen.queryByText(s.cards.projected.label)).not.toBeInTheDocument();
  });

  it('margem por plano pelo catálogo, mensal e anual', async () => {
    mockSummary(summary());
    renderTab();
    const table = await screen.findByRole('table', { name: s.plans.aria });
    const lite = within(table).getByText('LITE').closest('tr') as HTMLElement;
    // LITE: R$ 97 − R$ 10 = R$ 87 (89,7%); anual R$ 77 − R$ 10 = R$ 67 (87,0%).
    expect(norm(lite.textContent)).toContain('R$ 87,00');
    expect(norm(lite.textContent)).toContain('89,7%');
    expect(norm(lite.textContent)).toContain('R$ 67,00');
    expect(screen.getByText(S.marginLabel)).toBeInTheDocument();
  });

  it('sem cotação: só USD, sem margem e com aviso', async () => {
    const noFx = summary({ fx: null });
    noFx.totals.total = m(120, null);
    noFx.plans = noFx.plans.map((p) => ({ ...p, costPerTenant: p.costPerTenant && m(p.costPerTenant.usd, null) }));
    mockSummary(noFx);
    renderTab();
    expect(await screen.findByText(S.warnings.fx_missing)).toBeInTheDocument();
    expect(screen.getByText(S.marginHiddenNoFx)).toBeInTheDocument();
    expect(screen.queryByText(s.plans.columns.marginMonthly)).not.toBeInTheDocument();
    const total = screen.getByText(s.cards.total.label).closest('.MuiCard-root') as HTMLElement;
    expect(norm(total.textContent)).toContain('US$ 120,00');
    expect(total.textContent).not.toContain('R$');
  });

  it('sem amostra: custo por sessão e sessões fora do rateio', async () => {
    const empty = summary();
    empty.perSession = {
      contracted: { sessions: 0, perSession: null, unlimitedTenants: 0 },
      connected: { sessions: 0, perSession: null, unallocatedSessions: null, unallocatedCost: null },
    };
    mockSummary(empty);
    renderTab();
    const tile = (await screen.findByText(s.cards.perSession.label)).closest('.MuiCard-root') as HTMLElement;
    expect(within(tile).getByText(S.noSample)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: s.filters.connected }));
    expect(screen.getByText(s.plans.unallocatedNoSample)).toBeInTheDocument();
  });

  it('serviços: selo estimado, armazenamento a confirmar e plano vizinho', async () => {
    mockSummary(summary());
    renderTab();
    const table = await screen.findByRole('table', { name: s.services.aria });
    const banco = within(table).getByText('Banco').closest('tr') as HTMLElement;
    expect(within(banco).getByText(S.estimated)).toBeInTheDocument();
    expect(within(banco).getByText(S.storageToConfirm)).toBeInTheDocument();
    // `planLabel` vazio vale como ausente: só a categoria.
    expect(within(banco).getByText(S.category.database)).toBeInTheDocument();
    const worker = within(table).getByText('Worker').closest('tr') as HTMLElement;
    expect(within(worker).getByText('0.5c-512mb')).toBeInTheDocument();
    expect(norm(worker.textContent)).toContain('-US$ 36,00');
  });

  it('aviso de plano sem preço leva à aba Preços', async () => {
    mockSummary(summary());
    renderTab();
    const alert = (await screen.findByText(S.warnings.plan_without_price)).closest('.MuiAlert-root') as HTMLElement;
    expect(within(alert).getByText(/serviço API, plano 2c-4g/)).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: s.goToPrices })).toHaveAttribute('href', '/admin/costs/prices');
  });

  it('filtros: base conectadas e plano, persistidos na aba', async () => {
    mockSummary(summary());
    renderTab();
    await screen.findByRole('table', { name: s.plans.aria });
    await userEvent.click(screen.getByRole('button', { name: s.filters.connected }));
    expect(screen.getByText(s.plans.columns.sessionsConnected)).toBeInTheDocument();
    expect(screen.getByText(/2 sessões conectadas/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: s.filters.plan }));
    await userEvent.click(screen.getByRole('option', { name: 'MAX' }));
    const table = screen.getByRole('table', { name: s.plans.aria });
    expect(within(table).queryByText('LITE')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('ui.costs.filters')).toContain('connected');
  });

  it('pede só o mês, nunca preço de plano', async () => {
    const spy = mockSummary(summary());
    renderTab();
    await screen.findByRole('table', { name: s.plans.aria });
    expect(spy).toHaveBeenCalledWith(null);
  });

  it('erro com tentar de novo', async () => {
    const spy = mockSummary(new Error('x'));
    renderTab();
    expect(await screen.findByText(S.errors.loadFailed)).toBeInTheDocument();
    spy.mockResolvedValue(summary());
    await userEvent.click(screen.getByRole('button', { name: S.retry }));
    expect(await screen.findByRole('table', { name: s.plans.aria })).toBeInTheDocument();
  });
});

describe('SummaryTab — leitura lenta', () => {
  it('503 INFRA_COST_READ_UNAVAILABLE: estado próprio "tente de novo", não o de atualização', async () => {
    const spy = mockSummary(Object.assign(new Error('x'), { status: 503, code: 'INFRA_COST_READ_UNAVAILABLE', serviceUnavailable: true }));
    renderTab();
    expect(await screen.findByText(S.errors.readSlow)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockResolvedValue(summary());
    await userEvent.click(screen.getByRole('button', { name: S.retry }));
    expect(await screen.findByRole('table', { name: s.plans.aria })).toBeInTheDocument();
  });
});

describe('AdminCostsPage', () => {
  it('aba Resumo em /admin/costs', async () => {
    mockSummary(summary());
    renderWithTheme(<MemoryRouter initialEntries={['/admin/costs']}><AdminCostsPage /></MemoryRouter>, 'dark');
    expect(screen.getByRole('heading', { name: S.pageTitle })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: S.tabs.summary })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('table', { name: s.services.aria })).toBeInTheDocument();
  });

  it('aba ativa pelo caminho', () => {
    expect(activeCostsTab('/admin/costs')).toBe('/admin/costs');
    expect(activeCostsTab('/admin/costs/desconhecida')).toBe('/admin/costs');
  });
});

describe('SummaryTab — revisão R1', () => {
  it('amostra de sessões desatualizada: aviso com texto e "sem amostra recente" nas conectadas', async () => {
    const stale = summary({ warnings: [{ code: 'sessions_sample_stale' }] });
    stale.perSession.connected = { ...stale.perSession.connected, unallocatedSessions: null, unallocatedCost: null };
    mockSummary(stale);
    renderTab();
    expect(await screen.findByText(S.warnings.sessions_sample_stale)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: s.filters.connected }));
    expect(screen.getByText(s.unallocatedStale)).toBeInTheDocument();
  });

  it('avisos num único alerta, com o campo pelo nome legível e recolhidos após 3', async () => {
    const many = summary({
      warnings: [
        { code: 'storage_to_confirm', key: 'postgres', field: 'storage.gb' },
        { code: 'missing_hours' },
        { code: 'ai_tokens_missing' },
        { code: 'unlimited_contracted', count: 2 },
        { code: 'sessions_sample_stale' },
      ],
    });
    mockSummary(many);
    renderTab();
    const region = await screen.findByRole('region', { name: s.warningsTitle });
    expect(within(region).getByText(/Banco · Disco \(GB\)/)).toBeInTheDocument();
    expect(within(region).getAllByRole('listitem')).toHaveLength(3);
    const more = within(region).getByRole('button', { name: s.warningsMore(2) });
    expect(more).toHaveAttribute('aria-controls', region.querySelector('ul')?.id);
    await userEvent.click(more);
    expect(within(region).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getAllByRole('region', { name: s.warningsTitle })).toHaveLength(1);
  });

  it('margem fica na base contratadas mesmo com o filtro em conectadas', async () => {
    mockSummary(summary());
    renderTab();
    await screen.findByRole('table', { name: s.plans.aria });
    await userEvent.click(screen.getByRole('button', { name: s.filters.connected }));
    const lite = within(screen.getByRole('table', { name: s.plans.aria })).getByText('LITE').closest('tr') as HTMLElement;
    // Por tenant na conectadas (R$ 44), margem pelo contratadas: R$ 97 − R$ 10 = R$ 87.
    expect(norm(lite.textContent)).toContain('R$ 44,00');
    expect(norm(lite.textContent)).toContain('R$ 87,00');
  });

  it('custo marginal sem preço diz "sem preço", não "sem amostra"', async () => {
    mockSummary(summary({ marginalPerSession: null }));
    renderTab();
    const tile = (await screen.findByText(s.cards.marginal.label)).closest('.MuiCard-root') as HTMLElement;
    expect(within(tile).getByText(s.noPrice)).toBeInTheDocument();
  });

  it('sem cotação: alerta leva à aba Preços', async () => {
    mockSummary(summary({ fx: null }));
    renderTab();
    const alert = (await screen.findByText(S.warnings.fx_missing)).closest('.MuiAlert-root') as HTMLElement;
    expect(within(alert).getByRole('link', { name: s.goToPrices })).toHaveAttribute('href', '/admin/costs/prices');
  });

  it('"—" de plano vizinho sem foco, com texto para leitor de tela', async () => {
    mockSummary(summary());
    renderTab();
    const table = await screen.findByRole('table', { name: s.services.aria });
    const worker = within(table).getByText('Worker').closest('tr') as HTMLElement;
    const sr = within(worker).getByText(s.services.noNeighbor);
    expect(sr.closest('td')?.querySelector('[tabindex]')).toBeNull();
  });
});
