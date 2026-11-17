import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import { writePersisted } from '@/hooks/usePersistedState';
import type { SessionItem } from '@/types/api.types';
import type { SaverExtraction, SaverGroup, SaverOverview, SaverSessionGroup } from '../types';

const svc = vi.hoisted(() => ({
  getOverview: vi.fn(), listSessionGroups: vi.fn(), listGroups: vi.fn(), requestExtraction: vi.fn(),
  getExtraction: vi.fn(), cancelExtraction: vi.fn(), removeGroup: vi.fn(), exportContacts: vi.fn(),
}));
const sessionsSvc = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/services/saver.service', () => ({ saverService: svc }));
vi.mock('@/services/session.service', () => ({ sessionService: sessionsSvc }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 't1' }) }));
const auth = vi.hoisted(() => ({ user: { id: 'u1', isSuperAdmin: false } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));

import { SaverGroupsPage } from './SaverGroupsPage';
import { saverStrings as s } from '../strings';

const g = s.groups;
const usage = (used: number, limit: number | null) => ({ used, limit, remaining: limit === null ? null : limit - used });
const overview = (over: Partial<SaverOverview> = {}): SaverOverview => ({
  groups: usage(1, 10), contacts: usage(3, 1000), groupScansPerDay: usage(0, 20), autoRefreshEnabled: false,
  permissions: { view: true, extract: true, export: true, configure: true },
  config: { namePrefix: null, excludeAdminsByDefault: false, defaultFormat: 'CSV', autoRefresh: false },
  queueRunning: true, pilot: false, ...over,
});
const session = (over: Partial<SessionItem> = {}): SessionItem => ({
  id: 's1', tenantId: 't1', name: 'Atendimento', engine: 'baileys', phone: null, externalRef: null, status: 'CONNECTED',
  lastConnectedAt: null, lastDisconnectedAt: null, lastSeenAt: null, createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z', ...over,
});
const live = (jid: string, name: string, over: Partial<SaverSessionGroup> = {}): SaverSessionGroup => ({
  groupJid: jid, name, saved: false, savedGroupId: null, lastScannedAt: null, lastScanStatus: null,
  memberCount: null, kind: 'GROUP', selectable: true, unselectableReason: null, ...over,
});
const savedGroup = (id: string, over: Partial<SaverGroup> = {}): SaverGroup => ({
  id, groupJid: `${id}@g.us`, name: `Salvo ${id}`, sessionId: 's1', memberCount: 10, phoneCount: 7, lidOnlyCount: 3,
  lastScannedAt: '2026-11-16T13:30:00.000Z', lastScanStatus: 'DONE', createdAt: '2026-11-16T13:00:00.000Z', ...over,
});
const extraction = (status: SaverExtraction['status'], over: Partial<SaverExtraction> = {}): SaverExtraction => ({
  id: 'e1', sessionId: 's1', trigger: 'MANUAL', status, totalGroups: 2, doneGroups: 0, failedGroups: 0,
  membersFound: 0, newContacts: 0, createdAt: '2026-11-17T10:00:00.000Z', finishedAt: null, ...over,
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}
const page = (mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(
    <PrivacyProvider>
      <MemoryRouter initialEntries={['/saver']}>
        <Routes><Route path="*" element={<><SaverGroupsPage /><Where /></>} /></Routes>
      </MemoryRouter>
    </PrivacyProvider>,
    mode,
  );

async function pickSession(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('combobox', { name: g.session.label }));
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.user.isSuperAdmin = false;
  window.sessionStorage.clear();
  window.localStorage.clear();
  svc.getOverview.mockResolvedValue(overview());
  svc.listGroups.mockResolvedValue([]);
  svc.listSessionGroups.mockResolvedValue([]);
  sessionsSvc.list.mockResolvedValue({ sessions: [session()], total: 1 });
});
afterEach(() => vi.useRealTimers());

describe('SaverGroupsPage', () => {
  it.each(['light', 'dark'] as const)('sessão sem grupos mostra a lista vazia e o uso do plano (%s)', async (mode) => {
    const user = userEvent.setup();
    page(mode);
    await pickSession(user, 'Atendimento');
    expect(await screen.findByText(g.table.empty)).toBeInTheDocument();
    expect(screen.getByText(g.usage.scans)).toBeInTheDocument();
    expect(screen.getByText(g.saved.empty)).toBeInTheDocument();
  });

  it('sessão desconectada não consulta e leva a reconectar', async () => {
    sessionsSvc.list.mockResolvedValue({ sessions: [session({ status: 'DISCONNECTED' })], total: 1 });
    const user = userEvent.setup();
    page();
    await pickSession(user, 'Atendimento');
    expect(await screen.findByText(g.session.disconnectedTitle)).toBeInTheDocument();
    expect(svc.listSessionGroups).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: g.session.reconnect }));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings/sessions');
  });

  it('SESSION_NOT_CONNECTED da API também mostra o atalho para reconectar', async () => {
    svc.listSessionGroups.mockRejectedValue({ code: 'SESSION_NOT_CONNECTED', status: 409 });
    const user = userEvent.setup();
    page();
    await pickSession(user, 'Atendimento');
    expect(await screen.findByRole('button', { name: g.session.reconnect })).toBeInTheDocument();
  });

  it('sessão Telegram mostra o aviso e não consulta', async () => {
    sessionsSvc.list.mockResolvedValue({ sessions: [session({ id: 's2', name: 'Canal TG', engine: 'telegram' })], total: 1 });
    const user = userEvent.setup();
    page('dark');
    await pickSession(user, 'Canal TG');
    expect(await screen.findByText(g.session.telegramOnly)).toBeInTheDocument();
    expect(svc.listSessionGroups).not.toHaveBeenCalled();
  });

  it('sem sessão leva a conectar', async () => {
    sessionsSvc.list.mockResolvedValue({ sessions: [], total: 0 });
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole('button', { name: g.session.connect }));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings/sessions?create=1&returnTo=/saver');
  });

  it('seleção persiste após remontar e limpa ao concluir o pedido', async () => {
    svc.listSessionGroups.mockResolvedValue([live('a@g.us', 'Vendas'), live('b@g.us', 'Suporte', { saved: true })]);
    svc.requestExtraction.mockResolvedValue(extraction('QUEUED'));
    svc.getExtraction.mockResolvedValue(extraction('QUEUED'));
    const user = userEvent.setup();
    const first = page();
    await pickSession(user, 'Atendimento');
    await user.click(await screen.findByText('Vendas'));
    expect(screen.getByText(g.table.selected(1, 50))).toBeInTheDocument();
    first.unmount();

    page();
    expect(await screen.findByText(g.table.selected(1, 50))).toBeInTheDocument();
    expect(screen.getByText(g.table.saved)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: g.table.submit(1) }));
    expect(svc.requestExtraction).toHaveBeenCalledWith({ sessionId: 's1', groupJids: ['a@g.us'] });
    expect(await screen.findByText(g.progress.status.QUEUED!)).toBeInTheDocument();
    expect(screen.getByText(g.table.selected(0, 50))).toBeInTheDocument();
    expect(window.sessionStorage.getItem('ui.saver.groups.t1.selection')).toBeNull();
  });

  it('progresso para de consultar ao terminar e recarrega os grupos salvos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    writePersisted('saver.groups.t1.extraction', 'e1');
    svc.getExtraction
      .mockResolvedValueOnce(extraction('RUNNING', { doneGroups: 1, membersFound: 40 }))
      .mockResolvedValue(extraction('DONE', { doneGroups: 2, membersFound: 80, newContacts: 12 }));
    page();
    expect(await screen.findByText(g.progress.status.RUNNING!)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(await screen.findByText(g.progress.status.DONE!)).toBeInTheDocument();
    expect(screen.getByText(g.progress.newContacts(12))).toBeInTheDocument();
    await waitFor(() => expect(svc.listGroups).toHaveBeenCalledTimes(2));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(svc.getExtraction).toHaveBeenCalledTimes(2);
  });

  it('cancelar pede o cancelamento', async () => {
    writePersisted('saver.groups.t1.extraction', 'e1');
    svc.getExtraction.mockResolvedValue(extraction('RUNNING'));
    svc.cancelExtraction.mockResolvedValue(extraction('CANCELLED'));
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole('button', { name: g.progress.cancel }));
    expect(svc.cancelExtraction).toHaveBeenCalledWith('e1');
    expect(await screen.findByText(g.progress.status.CANCELLED!)).toBeInTheDocument();
  });

  it('limite esgotado mostra a faixa com caminho para os planos', async () => {
    svc.getOverview.mockResolvedValue(overview({ groupScansPerDay: usage(20, 20) }));
    const user = userEvent.setup();
    page();
    expect(await screen.findByText(g.limitBanner.reached(s.limitKeys.saver_group_scans_per_day!))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: g.limitBanner.cta }));
    expect(screen.getByTestId('where')).toHaveTextContent('/saver/plans');
  });

  it.each(['light', 'dark'] as const)('sem plano (%s): diz que o plano não inclui, sem "0 de 0" nem limite esgotado', async (mode) => {
    svc.getOverview.mockResolvedValue(overview({ groups: usage(0, 0), contacts: usage(0, 0), groupScansPerDay: usage(0, 0) }));
    const user = userEvent.setup();
    page(mode);
    expect(await screen.findByText(g.noPlan.title)).toBeInTheDocument();
    expect(screen.queryByText('0 de 0')).toBeNull();
    expect(screen.queryByText(g.limitBanner.title)).toBeNull();
    expect(screen.queryByText(g.pilot.title)).toBeNull();
    await user.click(screen.getByRole('button', { name: g.noPlan.cta }));
    expect(screen.getByTestId('where')).toHaveTextContent('/saver/plans');
  });

  it.each(['light', 'dark'] as const)('modo piloto (%s): limites do MAX, contagens e envio funcionam, sem "0 de 0"', async (mode) => {
    svc.getOverview.mockResolvedValue(overview({
      pilot: true, groups: usage(0, null), contacts: usage(0, null), groupScansPerDay: usage(2, 500),
    }));
    svc.listSessionGroups.mockResolvedValue([live('a@g.us', 'Vendas')]);
    svc.requestExtraction.mockResolvedValue(extraction('QUEUED'));
    const user = userEvent.setup();
    page(mode);
    expect(await screen.findByText(g.pilot.title)).toBeInTheDocument();
    expect(screen.getByText(g.pilot.body)).toBeInTheDocument();
    expect(screen.queryByText(g.noPlan.title)).toBeNull();
    expect(screen.queryByText('0 de 0')).toBeNull();
    expect(screen.queryByText(g.limitBanner.title)).toBeNull();
    await pickSession(user, 'Atendimento');
    await user.click(await screen.findByText('Vendas'));
    const submit = screen.getByRole('button', { name: g.table.submit(1) });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(svc.requestExtraction).toHaveBeenCalled();
  });

  it('um limite 0 com os outros no plano: "não incluso" no item, sem faixa de esgotado', async () => {
    svc.getOverview.mockResolvedValue(overview({ groupScansPerDay: usage(0, 0) }));
    page();
    expect(await screen.findByText(s.limits.notIncluded)).toBeInTheDocument();
    expect(screen.queryByText(g.limitBanner.title)).toBeNull();
  });

  it('PLAN_LIMIT_REACHED do pedido vira a faixa de limite', async () => {
    svc.listSessionGroups.mockResolvedValue([live('a@g.us', 'Vendas')]);
    svc.requestExtraction.mockRejectedValue({ code: 'PLAN_LIMIT_REACHED', status: 403, meta: { key: 'saver_groups', limit: 10 } });
    const user = userEvent.setup();
    page();
    await pickSession(user, 'Atendimento');
    await user.click(await screen.findByText('Vendas'));
    await user.click(screen.getByRole('button', { name: g.table.submit(1) }));
    expect(await screen.findByText(s.limitReached(s.limitKeys.saver_groups!, 10))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: g.limitBanner.cta })).toBeInTheDocument();
  });

  it('sem permissão de ler grupos o botão fica desabilitado', async () => {
    svc.getOverview.mockResolvedValue(overview({ permissions: { view: true, extract: false, export: false, configure: false } }));
    svc.listSessionGroups.mockResolvedValue([live('a@g.us', 'Vendas')]);
    const user = userEvent.setup();
    page();
    await pickSession(user, 'Atendimento');
    await screen.findByText('Vendas');
    expect(screen.getByRole('button', { name: g.table.submit(0) })).toBeDisabled();
  });

  it.each(['light', 'dark'] as const)('mostra membros, comunidade e total dos marcados; comunidade "pai" não marca (%s)', async (mode) => {
    svc.listSessionGroups.mockResolvedValue([
      live('a@g.us', 'Vendas', { memberCount: 1200 }),
      live('b@g.us', 'Bairro', { kind: 'COMMUNITY', selectable: false, unselectableReason: 'COMMUNITY_PARENT', memberCount: 3 }),
      live('c@g.us', 'Avisos do bairro', { kind: 'COMMUNITY_ANNOUNCE', memberCount: 800 }),
      live('d@g.us', 'Sem total'),
    ]);
    const user = userEvent.setup();
    page(mode);
    await pickSession(user, 'Atendimento');
    expect(await screen.findByText(g.table.members(1200), { exact: false })).toBeInTheDocument();
    expect(screen.getByText(g.table.kind.COMMUNITY!)).toBeInTheDocument();
    expect(screen.getByText(g.table.kind.COMMUNITY_ANNOUNCE!)).toBeInTheDocument();
    expect(screen.getByText(g.table.unselectable.COMMUNITY_PARENT!)).toBeInTheDocument();
    expect(screen.getByLabelText(g.table.membersUnknown)).toBeInTheDocument();

    await user.click(screen.getByText('Vendas'));
    await user.click(screen.getByText('Avisos do bairro'));
    expect(screen.getByText(g.table.selectedMembers(2000, false))).toBeInTheDocument();
    await user.click(screen.getByText('Sem total'));
    expect(screen.getByText(g.table.selectedMembers(2000, true))).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: g.table.selectAll }));
    await user.click(screen.getByRole('checkbox', { name: g.table.selectAll }));
    expect(screen.getByText(g.table.selected(3, 50))).toBeInTheDocument();
  });

  it.each(['light', 'dark'] as const)('copiar nome copia sem marcar a linha (%s)', async (mode) => {
    svc.listSessionGroups.mockResolvedValue([live('a@g.us', 'Vendas')]);
    svc.listGroups.mockResolvedValue([savedGroup('x')]);
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    page(mode);
    await pickSession(user, 'Atendimento');
    await user.click(await screen.findByRole('button', { name: s.groups.copyName.actionOf('Vendas') }));
    expect(writeText).toHaveBeenCalledWith('Vendas');
    expect(await screen.findByText(s.groups.copyName.copied, { selector: '.MuiAlert-message' })).toBeInTheDocument();
    expect(screen.getByText(g.table.selected(0, 50))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: s.groups.copyName.actionOf('Salvo x') }));
    expect(writeText).toHaveBeenLastCalledWith('Salvo x');
  });

  it('copiar com privacidade ligada: copia o nome real sem expô-lo no rótulo; falha avisa', async () => {
    window.localStorage.setItem('privacy.blur', JSON.stringify(['saver.groupNames']));
    svc.listSessionGroups.mockResolvedValue([live('a@g.us', 'Vendas')]);
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    page();
    await pickSession(user, 'Atendimento');
    expect(screen.queryByRole('button', { name: s.groups.copyName.actionOf('Vendas') })).toBeNull();
    const btn = await screen.findByRole('button', { name: s.groups.copyName.action });
    await user.click(btn);
    expect(writeText).toHaveBeenCalledWith('Vendas');
    writeText.mockRejectedValueOnce(new Error('denied'));
    const exec = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    await user.click(btn);
    expect(await screen.findByText(s.groups.copyName.failed)).toBeInTheDocument();
    expect(screen.getByText(g.table.selected(0, 50))).toBeInTheDocument();
  });

  it('grupos salvos mostram só contagens, aviso de número oculto e remover', async () => {
    svc.listGroups.mockResolvedValue([savedGroup('x')]);
    svc.removeGroup.mockResolvedValue(undefined);
    const user = userEvent.setup();
    page();
    expect(await screen.findByText('Salvo x')).toBeInTheDocument();
    expect(screen.getByText(g.saved.hiddenNotice(3))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `${g.saved.remove}: Salvo x` }));
    await user.click(screen.getByRole('button', { name: g.saved.removeConfirm }));
    expect(svc.removeGroup).toHaveBeenCalledWith('x');
  });

  it.each(['light', 'dark'] as const)('nomes de grupo borrados com a flag (%s)', async (mode) => {
    window.localStorage.setItem('privacy.blur', JSON.stringify(['saver.groupNames']));
    svc.listGroups.mockResolvedValue([savedGroup('x')]);
    svc.listSessionGroups.mockResolvedValue([live('a@g.us', 'Vendas')]);
    const user = userEvent.setup();
    page(mode);
    expect((await screen.findByText('Salvo x')).closest('[data-blurred="true"]')).not.toBeNull();
    await pickSession(user, 'Atendimento');
    expect((await screen.findByText('Vendas')).closest('[data-blurred="true"]')).not.toBeNull();
  });

  it('botão Exportar segue permissions.export do resumo', async () => {
    svc.listGroups.mockResolvedValue([savedGroup('x')]);
    svc.getOverview.mockResolvedValue(overview({ permissions: { view: true, extract: true, export: false, configure: false } }));
    const first = page();
    expect(await screen.findByText('Salvo x')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: g.saved.exportAll })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: g.saved.selectAll })).not.toBeInTheDocument();
    first.unmount();

    svc.getOverview.mockResolvedValue(overview({ permissions: { view: true, extract: true, export: true, configure: false } }));
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole('checkbox', { name: `${g.saved.selectGroup}: Salvo x` }));
    await user.click(screen.getByRole('button', { name: g.saved.exportSelected(1) }));
    expect(await screen.findByRole('dialog', { name: s.exportDialog.title })).toBeInTheDocument();
    expect(screen.getByText(s.exportDialog.scopeSelected(1))).toBeInTheDocument();
  });

  const many = (n: number) => Array.from({ length: n }, (_, i) =>
    live(`g${i}@g.us`, `Grupo ${String(i).padStart(3, '0')}`, { memberCount: i, saved: i % 10 === 0, lastScannedAt: i % 10 === 0 ? '2026-11-16T10:00:00.000Z' : null }));
  const scrollers = () => Array.from(document.body.querySelectorAll<HTMLElement>('*'))
    .filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) || ['auto', 'scroll'].includes(el.style.overflowY));

  it.each(['light', 'dark'] as const)('lista grande: uma só rolagem, 50 por vez e "Mostrar mais" (%s)', async (mode) => {
    svc.listSessionGroups.mockResolvedValue(many(120));
    svc.listGroups.mockResolvedValue([savedGroup('x')]);
    const user = userEvent.setup();
    page(mode);
    await pickSession(user, 'Atendimento');
    expect(await screen.findByText(g.table.showing(50, 120))).toBeInTheDocument();
    expect(screen.getByText('Grupo 049')).toBeInTheDocument();
    expect(screen.queryByText('Grupo 050')).toBeNull();
    expect(scrollers()).toEqual([]);
    await user.click(screen.getByRole('button', { name: g.table.showMore(50) }));
    expect(screen.getByText(g.table.showing(100, 120))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: g.table.showMore(20) }));
    expect(screen.getByText('Grupo 119')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mostrar mais/ })).toBeNull();
    expect(window.sessionStorage.getItem('ui.saver.groups.t1.shown')).toContain('"d":150');
  });

  it('filtros rápidos, ordenação por membros e busca persistem; filtro vazio volta para todos', async () => {
    svc.listSessionGroups.mockResolvedValue([
      ...many(3),
      live('c@g.us', 'Bairro', { kind: 'COMMUNITY', selectable: false, unselectableReason: 'COMMUNITY_PARENT' }),
    ]);
    const user = userEvent.setup();
    const first = page();
    await pickSession(user, 'Atendimento');
    await screen.findByText('Bairro');
    await user.click(screen.getByRole('button', { name: `${g.table.filters.saved} 1` }));
    expect(screen.getByText('Grupo 000')).toBeInTheDocument();
    expect(screen.queryByText('Grupo 001')).toBeNull();
    await user.click(screen.getByRole('button', { name: `${g.table.filters.communities} 1` }));
    expect(screen.getByText('Bairro')).toBeInTheDocument();
    expect(screen.queryByText('Grupo 000')).toBeNull();
    await user.click(screen.getByRole('button', { name: `${g.table.filters.all} 4` }));
    await user.click(screen.getByRole('button', { name: g.table.sort.members }));
    const names = () => screen.getAllByText(/^(Grupo \d+|Bairro)$/).map((el) => el.textContent);
    expect(names()).toEqual(['Grupo 002', 'Grupo 001', 'Grupo 000', 'Bairro']);
    first.unmount();

    page();
    expect(await screen.findByRole('button', { name: g.table.sort.members })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: `${g.table.filters.unread} 3` }));
    await user.type(screen.getByRole('textbox', { name: g.table.searchAria }), 'zzz');
    expect(screen.getByText(g.table.noMatch)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: g.table.resetFilters }));
    expect(screen.getByText(g.table.showing(4, 4))).toBeInTheDocument();
  });

  it('barra de ações fica presa ao rodapé só com grupo marcado', async () => {
    svc.listSessionGroups.mockResolvedValue([live('a@g.us', 'Vendas', { memberCount: 12 })]);
    const user = userEvent.setup();
    page('dark');
    await pickSession(user, 'Atendimento');
    const bar = await screen.findByRole('region', { name: g.table.selectionBar });
    expect(bar).toHaveAttribute('data-sticky', 'false');
    expect(getComputedStyle(bar).position).not.toBe('sticky');
    await user.click(screen.getByText('Vendas'));
    expect(bar).toHaveAttribute('data-sticky', 'true');
    expect(getComputedStyle(bar).position).toBe('sticky');
    expect(screen.getByText(g.table.selectedMembers(12, false))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: g.table.clear }));
    expect(bar).toHaveAttribute('data-sticky', 'false');
    expect(scrollers()).toEqual([]);
  });

  it('com borrão: checkbox e avatar não levam o nome nem as iniciais', async () => {
    window.localStorage.setItem('privacy.blur', JSON.stringify(['saver.groupNames']));
    svc.listSessionGroups.mockResolvedValue([live('a@g.us', 'Vendas Norte')]);
    svc.listGroups.mockResolvedValue([savedGroup('x', { name: 'Zeta Club' })]);
    const user = userEvent.setup();
    page();
    await pickSession(user, 'Atendimento');
    await screen.findByText('Vendas Norte');
    expect(screen.getByRole('checkbox', { name: g.table.selectGroup })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Vendas Norte/ })).toBeNull();
    expect(screen.queryByText('VN')).toBeNull();
    expect(screen.queryByText('ZC')).toBeNull();
  });

  it('sem borrão: checkbox nomeado pelo grupo e avatar com iniciais', async () => {
    svc.listSessionGroups.mockResolvedValue([live('a@g.us', 'Vendas Norte')]);
    const user = userEvent.setup();
    page();
    await pickSession(user, 'Atendimento');
    expect(await screen.findByRole('checkbox', { name: `${g.table.selectGroup}: Vendas Norte` })).toBeInTheDocument();
    expect(screen.getByText('VN')).toBeInTheDocument();
  });

  it('seleção salva é podada e marcados fora do filtro aparecem na barra e vão no pedido', async () => {
    writePersisted('saver.groups.t1.session', 's1');
    writePersisted('saver.groups.t1.selection', ['a@g.us', 'b@g.us', 'c@g.us', 'sumiu@g.us']);
    svc.listSessionGroups.mockResolvedValue([
      live('a@g.us', 'Vendas', { saved: true, lastScannedAt: '2026-11-16T10:00:00.000Z' }),
      live('b@g.us', 'Suporte'),
      live('c@g.us', 'Bairro', { kind: 'COMMUNITY', selectable: false, unselectableReason: 'COMMUNITY_PARENT' }),
    ]);
    svc.requestExtraction.mockResolvedValue(extraction('QUEUED'));
    const user = userEvent.setup();
    page();
    expect(await screen.findByText(g.table.selected(2, 50))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `${g.table.filters.saved} 1` }));
    expect(screen.getByText(g.table.outsideView(1))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: g.table.submit(2) }));
    expect(svc.requestExtraction).toHaveBeenCalledWith({ sessionId: 's1', groupJids: ['a@g.us', 'b@g.us'] });
  });

  it('grupo salvo mostra o selo de tipo quando a sessão aberta informa', async () => {
    svc.listSessionGroups.mockResolvedValue([live('x@g.us', 'Avisos', { kind: 'COMMUNITY_ANNOUNCE' })]);
    svc.listGroups.mockResolvedValue([savedGroup('x')]);
    const user = userEvent.setup();
    page();
    await screen.findByText('Salvo x');
    expect(screen.queryByText(g.table.kind.COMMUNITY_ANNOUNCE!)).toBeNull();
    await pickSession(user, 'Atendimento');
    await screen.findByText('Avisos');
    expect(screen.getAllByText(g.table.kind.COMMUNITY_ANNOUNCE!)).toHaveLength(2);
  });

  it.each(['light', 'dark'] as const)('selo de admin, aviso de números ocultos, filtro "Sou admin" e aviso na barra (%s)', async (mode) => {
    svc.listSessionGroups.mockResolvedValue([
      live('a@g.us', 'Avisos Norte', { kind: 'COMMUNITY_ANNOUNCE', selfIsAdmin: false }),
      live('b@g.us', 'Avisos Sul', { kind: 'COMMUNITY_ANNOUNCE', selfIsAdmin: true }),
      live('c@g.us', 'Vendas', { selfIsAdmin: false }),
      live('d@g.us', 'Suporte'),
    ]);
    const user = userEvent.setup();
    const first = page(mode);
    await pickSession(user, 'Atendimento');
    await screen.findByText('Avisos Norte');
    expect(screen.getAllByText(g.table.selfAdmin)).toHaveLength(1);
    const notice = screen.getByText(g.table.hiddenNumbers);
    expect(notice.closest('li')).toHaveTextContent('Avisos Norte');
    await user.hover(notice);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(g.table.hiddenNumbersHint);
    expect(tip).not.toHaveTextContent('Avisos Norte');
    await user.unhover(notice);

    // Marcar não é bloqueado: a barra só avisa.
    expect(screen.queryByText(g.table.hiddenNumbersSelected(1))).toBeNull();
    await user.click(screen.getByText('Avisos Norte'));
    await user.click(screen.getByText('Vendas'));
    expect(screen.getByText(g.table.hiddenNumbersSelected(1))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: g.table.submit(2) })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: `${g.table.filters.selfAdmin} 1` }));
    expect(screen.getByText('Avisos Sul')).toBeInTheDocument();
    expect(screen.queryByText('Avisos Norte')).toBeNull();
    first.unmount();

    // Filtro persistido.
    page(mode);
    expect(await screen.findByRole('button', { name: `${g.table.filters.selfAdmin} 1` })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Avisos Norte')).toBeNull();
  });

  it('grupos salvos: causa provável só quando quase todos vieram ocultos', async () => {
    svc.listGroups.mockResolvedValue([savedGroup('x'), savedGroup('y', { memberCount: 100, phoneCount: 5, lidOnlyCount: 95 })]);
    const first = page();
    await screen.findByText('Salvo x');
    expect(screen.getByText(g.saved.hiddenLikelyCause(1))).toBeInTheDocument();
    expect(screen.getByText(g.saved.hiddenNotice(98), { exact: false })).toBeInTheDocument();
    first.unmount();

    svc.listGroups.mockResolvedValue([savedGroup('x')]);
    page();
    await screen.findByText('Salvo x');
    expect(screen.getByText(g.saved.hiddenNotice(3))).toBeInTheDocument();
    expect(screen.queryByText(/Causa provável/)).toBeNull();
  });

  it('marcação de grupo que não existe mais não vira "exportar todos"', async () => {
    writePersisted('saver.groups.t1.exportSelection', ['sumiu', 'x']);
    svc.listGroups.mockResolvedValue([savedGroup('x'), savedGroup('y')]);
    svc.getOverview.mockResolvedValue(overview({ permissions: { view: true, extract: true, export: true, configure: false } }));
    page();
    expect(await screen.findByRole('button', { name: g.saved.exportSelected(1) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: g.saved.exportAll })).not.toBeInTheDocument();
  });
});
