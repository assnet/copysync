import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import { PRIVACY_SCREENS } from '@/features/privacy/privacyFlags';
import { AdminUsagePage } from '@/pages/admin/AdminUsagePage';
import { adminUsageService } from '@/services/adminUsage.service';
import { USAGE_FEATURE_ROUTE, USAGE_PATH, usageFeaturePath } from '../paths';
import { featureUsageStrings as S } from '../strings';
import { detailFixture, summaryFixture } from '../testFixtures';
import type { UsageFeatureDetail, UsageTenantItem, UsageTenantsPage } from '../types';

vi.mock('@/services/serverClock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/serverClock')>()),
  serverNow: () => Date.UTC(2026, 10, 18, 1, 0, 0),
}));

vi.mock('@mui/x-charts/LineChart', () => ({ LineChart: () => <div data-testid="line-chart" /> }));

vi.mock('@/services/adminUsage.service', () => ({
  adminUsageService: { getSummary: vi.fn(), getDetail: vi.fn(), getTenants: vi.fn() },
}));

const getSummary = vi.mocked(adminUsageService.getSummary);
const getDetail = vi.mocked(adminUsageService.getDetail);
const getTenants = vi.mocked(adminUsageService.getTenants);

const TENANT_ID = '1a2b3c4d-0000-4000-8000-000000000001';

function tenant(over: Partial<UsageTenantItem> = {}): UsageTenantItem {
  return {
    tenantId: TENANT_ID, tenantName: 'Loja Alfa', plan: 'COPYSYNC_MAX', status: 'ACTIVE', internal: false,
    uses: 21, activeDays: 6, lastUsedDay: '2026-11-14', ...over,
  };
}

const page = (items: UsageTenantItem[], nextCursor: string | null = null): UsageTenantsPage => ({ items, nextCursor });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function renderAt(path: string, mode: 'light' | 'dark' = 'light') {
  return renderWithTheme(
    <PrivacyProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={USAGE_PATH} element={<AdminUsagePage />} />
          <Route path={USAGE_FEATURE_ROUTE} element={<AdminUsagePage />} />
        </Routes>
      </MemoryRouter>
    </PrivacyProvider>,
    mode,
  );
}

const DETAIL_PATH = usageFeaturePath('offer_hunter');

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  getSummary.mockReset();
  getDetail.mockReset();
  getTenants.mockReset();
  getDetail.mockResolvedValue(detailFixture());
  getTenants.mockResolvedValue(page([tenant()]));
});

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('FeatureDetailTab', () => {
  it('lê o detalhe pela chave da URL e só depois a lista de contas (a fila da rede está em UsageReadQueue.test)', async () => {
    const d = deferred<UsageFeatureDetail>();
    getDetail.mockReturnValueOnce(d.promise);
    renderAt(DETAIL_PATH);
    await waitFor(() => expect(getDetail).toHaveBeenCalledTimes(1));
    expect(getDetail.mock.calls[0][0]).toBe('offer_hunter');
    expect(getTenants).not.toHaveBeenCalled();
    expect(getSummary).not.toHaveBeenCalled();
    await act(async () => { d.resolve(detailFixture()); });
    expect(await screen.findByText('Loja Alfa')).toBeInTheDocument();
    expect(getTenants).toHaveBeenCalledTimes(1);
    const [, query, cursor] = getTenants.mock.calls[0];
    expect(cursor).toBeUndefined();
    expect(query).not.toHaveProperty('limit');
    expect(query).not.toHaveProperty('offset');
    expect(screen.getByText(S.detail.measuresTitle)).toBeInTheDocument();
    expect(screen.getByText(S.detail.byKindTitle)).toBeInTheDocument();
  });

  it('"Carregar mais" espera a leitura anterior e só envia o cursor recebido', async () => {
    const user = userEvent.setup();
    getTenants
      .mockResolvedValueOnce(page([tenant()], 'c1'))
      .mockResolvedValueOnce(page([tenant({ tenantId: 't2', tenantName: 'Loja Beta' })]));
    renderAt(DETAIL_PATH);
    await user.click(await screen.findByRole('button', { name: S.actions.loadMore }));
    expect(await screen.findByText('Loja Beta')).toBeInTheDocument();
    const [, query, cursor] = getTenants.mock.calls[1];
    expect(cursor).toBe('c1');
    expect(query).not.toHaveProperty('limit');
    expect(query).not.toHaveProperty('offset');
    expect(screen.queryByRole('button', { name: S.actions.loadMore })).toBeNull();
  });

  it('cursor inválido recarrega do início com aviso e foco', async () => {
    const user = userEvent.setup();
    getTenants
      .mockResolvedValueOnce(page([tenant()], 'velho'))
      .mockRejectedValueOnce({ status: 400, code: 'USAGE_METRICS_CURSOR_INVALID' })
      .mockResolvedValueOnce(page([tenant()]));
    renderAt(DETAIL_PATH);
    await user.click(await screen.findByRole('button', { name: S.actions.loadMore }));
    const notice = await screen.findByText(S.tenants.cursorReset);
    await waitFor(() => expect(notice.closest('[role="status"]')).toHaveFocus());
    expect(getTenants).toHaveBeenCalledTimes(3);
    expect(getTenants.mock.calls[2][2]).toBeUndefined();
  });

  it('nome da conta sai borrado com a flag ligada', async () => {
    expect(PRIVACY_SCREENS.find((s) => s.id === 'usage')!.flags.map((f) => f.id)).toContain('usage.tenantName');
    window.localStorage.setItem('privacy.blur', JSON.stringify(['usage.tenantName']));
    renderAt(DETAIL_PATH, 'dark');
    const name = await screen.findByText('Loja Alfa');
    expect(name.closest('[data-blurred]')).not.toBeNull();
    // O rótulo acessível da ação não vaza o nome borrado.
    expect(screen.getByRole('button', { name: S.actions.filterByAccountAria(S.filters.accountShort(TENANT_ID)) })).toBeInTheDocument();
    // `Blurred` deixa o nome no DOM: fora da árvore acessível, e o leitor de tela lê o id curto.
    expect(name.closest('[aria-hidden="true"]')).not.toBeNull();
    const row = name.closest('tr')!;
    expect(within(row as HTMLElement).getByText(S.filters.accountShort(TENANT_ID))).toBeInTheDocument();
    // Chip da conta filtrada: nome borrado e rótulo acessível só com o id curto.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: S.actions.filterByAccountAria(S.filters.accountShort(TENANT_ID)) }));
    const chip = await screen.findByLabelText(S.filters.accountShort(TENANT_ID), { selector: '.MuiChip-root' });
    expect(within(chip).getByText('Loja Alfa').closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('filtrar por esta conta: chip com o nome, só o id salvo; após reload o chip mostra o id curto', async () => {
    const user = userEvent.setup();
    const first = renderAt(DETAIL_PATH);
    await user.click(await screen.findByRole('button', { name: S.actions.filterByAccountAria('Loja Alfa') }));
    await waitFor(() => expect(getDetail).toHaveBeenLastCalledWith('offer_hunter', expect.objectContaining({ tenantId: TENANT_ID })));
    await waitFor(() => expect(screen.getAllByText('Loja Alfa').length).toBeGreaterThan(1));
    const stored = window.sessionStorage.getItem('ui.usage.filters') ?? '';
    expect(stored).toContain(TENANT_ID);
    expect(Object.values({ ...window.sessionStorage }).join('')).not.toContain('Loja Alfa');
    first.unmount();

    getSummary.mockResolvedValue(summaryFixture());
    renderAt(USAGE_PATH);
    expect(await screen.findByText(S.filters.accountShort(TENANT_ID))).toBeInTheDocument();
  });

  it('chave inexistente mostra EmptyState com voltar', async () => {
    getDetail.mockRejectedValueOnce({ status: 404, code: 'USAGE_METRICS_FEATURE_NOT_FOUND' });
    renderAt(usageFeaturePath('nao_existe'));
    expect(await screen.findByText(S.detail.notFoundTitle)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: S.actions.back })[0]).toHaveAttribute('href', USAGE_PATH);
    expect(getTenants).not.toHaveBeenCalled();
  });

  it('série alterna entre gráfico e tabela', async () => {
    const user = userEvent.setup();
    renderAt(DETAIL_PATH);
    await user.click(await screen.findByRole('button', { name: S.actions.showTable }));
    const table = screen.getByRole('table', { name: S.trend.tableAria });
    expect(within(table).getByText(S.trend.weekOf('09/11'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: S.actions.showChart })).toBeInTheDocument();
  });

  it('"Atualizar" com falha mantém o detalhe anterior e avisa que está desatualizado', async () => {
    const user = userEvent.setup();
    renderAt(DETAIL_PATH);
    await screen.findByText('Loja Alfa');
    getDetail.mockRejectedValueOnce({ code: 'USAGE_METRICS_READ_UNAVAILABLE', status: 503 });
    await user.click(screen.getByRole('button', { name: S.actions.refreshAria }));
    expect(await screen.findByText(S.errors.staleSlow)).toBeInTheDocument();
    expect(screen.getByText(S.detail.measuresTitle)).toBeInTheDocument();
    expect(screen.getByText('Loja Alfa')).toBeInTheDocument();
  });

  it('recurso fora dos filtros de tipo/plano: aviso com "Limpar filtros" e "Voltar", sem lista de contas', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem('ui.usage.filters', JSON.stringify({ v: 1, d: { kinds: ['AUDIENCE'], plan: 'SAVER_MAX' } }));
    getDetail.mockResolvedValue({ ...detailFixture(), inScope: false });
    renderAt(DETAIL_PATH);
    expect(await screen.findByText(S.detail.outOfScopeTitle)).toBeInTheDocument();
    expect(screen.queryByText(S.detail.notFoundTitle)).toBeNull();
    expect(screen.getAllByRole('link', { name: S.actions.back }).length).toBeGreaterThan(1);
    expect(getTenants).not.toHaveBeenCalled();
    getDetail.mockResolvedValue({ ...detailFixture(), inScope: true });
    await user.click(screen.getByRole('button', { name: S.actions.clearFilters }));
    expect(await screen.findByText('Loja Alfa')).toBeInTheDocument();
    expect(getDetail).toHaveBeenLastCalledWith('offer_hunter', expect.objectContaining({ kind: 'ACTION,AUTOMATIC' }));
  });

  it('"Atualizar" mantém as contas anteriores com carregando e nunca mostra a lista vazia na espera', async () => {
    const user = userEvent.setup();
    renderAt(DETAIL_PATH);
    await screen.findByText('Loja Alfa');
    const d = deferred<UsageFeatureDetail>();
    const l = deferred<UsageTenantsPage>();
    getDetail.mockReturnValueOnce(d.promise);
    getTenants.mockReturnValueOnce(l.promise);
    await user.click(screen.getByRole('button', { name: S.actions.refreshAria }));
    expect(screen.getByText('Loja Alfa')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: S.tenants.loading })).toBeInTheDocument();
    expect(screen.queryByText(S.tenants.empty)).toBeNull();
    await act(async () => { d.resolve(detailFixture()); });
    await waitFor(() => expect(getTenants).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Loja Alfa')).toBeInTheDocument();
    expect(screen.queryByText(S.tenants.empty)).toBeNull();
    await act(async () => { l.resolve(page([tenant({ tenantName: 'Loja Nova' })])); });
    expect(await screen.findByText('Loja Nova')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: S.tenants.loading })).toBeNull();
  });
});
