import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import { PRIVACY_SCREENS } from '@/features/privacy/privacyFlags';
import { AdminCostsPage, activeCostsTab } from '@/pages/admin/AdminCostsPage';
import { adminCostsService } from '@/services/adminCosts.service';
import { infraCostsStrings as S } from '../strings';
import type { InfraCostTenantsPage, InfraCostTenantView, InfraMoney } from '../types';
import TenantsTab from './TenantsTab';

vi.mock('@/services/serverClock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/serverClock')>()),
  serverNow: () => Date.parse('2026-11-12T10:00:00.000Z'),
}));

const t = S.tenants;
const m = (usd: number, brl: number | null = usd * 5): InfraMoney => ({ usd, brl });

function tenant(over: Partial<InfraCostTenantView> = {}): InfraCostTenantView {
  return {
    tenantId: 't1', tenantName: 'Loja Alfa', planSlug: 'COPYSYNC_LITE', contractedSessions: 2, sessionHours: 1200,
    shared: m(4), connectedShared: m(3), projectedShared: m(6), ai: m(1), total: m(5), ...over,
  };
}

function page(over: Partial<InfraCostTenantsPage> = {}): InfraCostTenantsPage {
  return {
    month: '2026-11', status: 'open', basis: 'hours', fx: { rate: 5, referenceDate: '2026-11-11', source: 'ptax' },
    sharedBasis: 'contracted', unallocated: null, excluded: null,
    tenants: [tenant()], nextCursor: null, ...over,
  };
}

const mockTenants = (...pages: (InfraCostTenantsPage | Error)[]) => {
  const spy = vi.spyOn(adminCostsService, 'getTenants');
  for (const p of pages) spy.mockImplementationOnce(async () => { if (p instanceof Error) throw p; return p; });
  return spy;
};

const renderTab = (mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(<PrivacyProvider><MemoryRouter><TenantsTab /></MemoryRouter></PrivacyProvider>, mode);

beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

describe('TenantsTab', () => {
  it.each(['light', 'dark'] as const)('mês aberto: estimativa, colunas e margem projetada (%s)', async (mode) => {
    mockTenants(page());
    renderTab(mode);
    const table = await screen.findByRole('table', { name: t.aria });
    expect(within(table).getByText('Loja Alfa')).toBeInTheDocument();
    expect(screen.getByText(t.statusOpen)).toBeInTheDocument();
    expect(within(table).getByText(t.marginProjected)).toBeInTheDocument();
    // Margem = 97 (LITE) − (projetado 30 + IA 5) = 62.
    expect(within(table).getByText(/R\$\s?62,00/)).toBeInTheDocument();
  });

  it('mês fechado: valores congelados e margem pelo total', async () => {
    mockTenants(page({
      month: '2026-10', status: 'closed', excluded: m(6), unallocated: m(0),
      tenants: [tenant({ projectedShared: null, connectedShared: null })],
    }));
    renderTab();
    const table = await screen.findByRole('table', { name: t.aria });
    expect(screen.getByText(t.statusClosed)).toBeInTheDocument();
    expect(screen.getByText(t.orderClosed, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/US\$ 6,00/);
    expect(within(table).queryByText(t.marginProjected)).not.toBeInTheDocument();
    // Custo congelado, preço do plano atual: o cabeçalho diz qual preço a margem usa.
    expect(within(table).getByText(t.marginCurrentPrice)).toBeInTheDocument();
    expect(within(table).queryByText(t.columns.margin)).not.toBeInTheDocument();
    expect(t.statusClosed).toContain('custos congelados');
  });

  it('flag costs.tenantName borra o nome, registrada no diálogo', async () => {
    expect(PRIVACY_SCREENS.find((s) => s.id === 'costs')!.flags.map((f) => f.id)).toEqual(['costs.tenantName']);
    localStorage.setItem('privacy.blur', JSON.stringify(['costs.tenantName']));
    mockTenants(page());
    renderTab();
    const name = await screen.findByText('Loja Alfa');
    expect(name.closest('[data-blurred]')).not.toBeNull();
  });

  it('carregar mais: devolve só o cursor recebido e acumula', async () => {
    const spy = mockTenants(
      page({ nextCursor: 'c1' }),
      page({ tenants: [tenant({ tenantId: 't2', tenantName: 'Loja Beta' })], nextCursor: null }),
    );
    renderTab();
    await screen.findByText('Loja Alfa');
    await userEvent.click(screen.getByRole('button', { name: t.loadMore }));
    expect(await screen.findByText('Loja Beta')).toBeInTheDocument();
    expect(screen.getByText('Loja Alfa')).toBeInTheDocument();
    expect(spy).toHaveBeenLastCalledWith({ month: null, plan: null, cursor: 'c1' });
    for (const [q] of spy.mock.calls) expect(Object.keys(q ?? {}).sort()).not.toContain('limit');
    expect(screen.queryByRole('button', { name: t.loadMore })).not.toBeInTheDocument();
  });

  it('cursor inválido: recarrega do início com aviso curto', async () => {
    const spy = mockTenants(
      page({ nextCursor: 'velho' }),
      Object.assign(new Error('400'), { status: 400, code: 'INFRA_COST_CURSOR_INVALID' }) as never,
      page({ tenants: [tenant({ tenantId: 't3', tenantName: 'Loja Gama' })] }),
    );
    renderTab();
    await screen.findByText('Loja Alfa');
    await userEvent.click(screen.getByRole('button', { name: t.loadMore }));
    expect(await screen.findByText('Loja Gama')).toBeInTheDocument();
    expect(screen.getByText(t.cursorReset)).toBeInTheDocument();
    // O botão focado sumiu com a recarga: o foco vai para o aviso.
    expect(screen.getByText(t.cursorReset).closest('[role="status"]')).toHaveFocus();
    expect(screen.queryByText('Loja Alfa')).not.toBeInTheDocument();
    expect(spy).toHaveBeenLastCalledWith({ month: null, plan: null });
  });

  it('base do rateio pela sessão-hora quando não há contratadas', async () => {
    mockTenants(page({ sharedBasis: 'session_hours' }));
    renderTab();
    expect(await screen.findByText(t.sharedBasis.session_hours)).toBeInTheDocument();
  });

  it('ordem dita na lista: nome no mês aberto, custo no fechado', async () => {
    mockTenants(page());
    renderTab();
    expect(await screen.findByText(new RegExp(t.orderOpen))).toBeInTheDocument();
  });

  it('filtro de plano vai para a API no slug do domínio e fica salvo na aba', async () => {
    const spy = mockTenants(page(), page({ tenants: [] }));
    renderTab();
    await screen.findByText('Loja Alfa');
    await userEvent.click(screen.getByRole('combobox', { name: S.summary.filters.plan }));
    await userEvent.click(screen.getByRole('option', { name: 'PRO' }));
    expect(await screen.findByText(t.emptyPlan)).toBeInTheDocument();
    expect(spy).toHaveBeenLastCalledWith({ month: null, plan: 'COPYSYNC_PRO' });
    expect(sessionStorage.getItem('ui.costs.filters')).toContain('pro');
  });

  it('sem cotação: sem coluna de margem', async () => {
    mockTenants(page({ fx: null, tenants: [tenant({ shared: m(4, null), projectedShared: m(6, null), ai: m(1, null), total: m(5, null) })] }));
    renderTab();
    const table = await screen.findByRole('table', { name: t.aria });
    expect(within(table).queryByText(t.columns.margin)).not.toBeInTheDocument();
    expect(screen.getByText(t.noFx)).toBeInTheDocument();
  });

  it('mês corrente sem snapshot: estado vazio próprio', async () => {
    mockTenants(page({ basis: 'snapshot', tenants: [] }));
    renderTab();
    expect(await screen.findByText(t.emptySnapshot)).toBeInTheDocument();
  });

  it('erro com tentar de novo', async () => {
    mockTenants(new Error('x'), page());
    renderTab();
    await userEvent.click(await screen.findByRole('button', { name: S.retry }));
    expect(await screen.findByRole('table', { name: t.aria })).toBeInTheDocument();
  });
});

describe('AdminCostsPage — Por cliente', () => {
  it('aba em /admin/costs/tenants', async () => {
    mockTenants(page());
    renderWithTheme(<PrivacyProvider><MemoryRouter initialEntries={['/admin/costs/tenants']}><AdminCostsPage /></MemoryRouter></PrivacyProvider>, 'dark');
    expect(screen.getByRole('tab', { name: S.tabs.tenants })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('table', { name: t.aria })).toBeInTheDocument();
    expect(activeCostsTab('/admin/costs/tenants')).toBe('/admin/costs/tenants');
    expect(activeCostsTab('/admin/costs/history')).toBe('/admin/costs/history');
  });
});
