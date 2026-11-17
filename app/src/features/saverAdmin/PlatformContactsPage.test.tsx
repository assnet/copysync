import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';
import { LEGACY_PRODUCTS } from '@/features/products/productAccess';
import { buildNavigation, SAVER_ADMIN_PATH } from '@/features/navigation/model';

const svc = vi.hoisted(() => ({ listContacts: vi.fn(), getContact: vi.fn(), exportContacts: vi.fn(), listTenants: vi.fn(), getSummary: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { isSuperAdmin: true } as { isSuperAdmin: boolean } | null }));
vi.mock('@/services/saverAdmin.service', () => ({ saverAdminService: svc }));
const useTenant = vi.hoisted(() => vi.fn(() => ({ tenants: [] })));
vi.mock('@/contexts/TenantContext', () => ({ useTenant }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));

import { PlatformContactsPage } from './PlatformContactsPage';
import { SuperAdminRoute } from '@/features/ai/components/SuperAdminRoute';
import { saverAdminStrings as s } from './strings';
import { formatDateTime } from './format';
import { EMPTY_PLATFORM_FILTERS } from './types';

const contact = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Contato ${id}`, phone: `551198765000${id}`, lid: `lid-${id}`, tenantCount: 2, groupCount: 3,
  firstSeenAt: '2026-11-01T10:00:00.000Z', lastSeenAt: '2026-11-10T12:30:00.000Z',
  firstExtractedAt: '2026-11-01T10:00:00.000Z', lastExtractedAt: '2026-11-10T12:30:00.000Z', ...over,
});
const page = (mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(<PrivacyProvider><MemoryRouter><PlatformContactsPage /></MemoryRouter></PrivacyProvider>, mode);
const rows = () => screen.queryAllByTestId('platform-contact-row');

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  auth.user = { isSuperAdmin: true };
  svc.listTenants.mockResolvedValue({ items: [{ id: 't1', name: 'Loja Azul' }, { id: 't2', name: 'Loja Verde' }], nextCursor: null });
  svc.getSummary.mockResolvedValue({ total: 1200, filtered: 12, withPhone: 9, lidOnly: 3, topDdi: [{ ddi: '55', count: 8 }, { ddi: '351', count: 1 }], topDdd: [], ddiBase: 9, dddBase: 0 });
});

describe('PlatformContactsPage', () => {
  it.each(['light', 'dark'] as const)('uma linha por contato com telefone, LID, contagens e data e hora (%s)', async (mode) => {
    svc.listContacts.mockResolvedValue({ items: [contact('1'), contact('2', { phone: null, name: null })], nextCursor: null });
    page(mode);
    await waitFor(() => expect(rows()).toHaveLength(2));
    const first = within(rows()[0]!);
    expect(first.getByText('+55')).toBeInTheDocument();
    expect(first.getByText('11')).toBeInTheDocument();
    expect(first.getByText('98765-0001')).toBeInTheDocument();
    expect(first.getByText('lid-1')).toBeInTheDocument();
    expect(first.getAllByText(formatDateTime('2026-11-10T12:30:00.000Z')!)).toHaveLength(1);
    expect(first.getByText('2')).toBeInTheDocument();
    expect(first.getByText('3')).toBeInTheDocument();
    expect(within(rows()[1]!).getByText(s.table.lidOnly)).toBeInTheDocument();
    expect(within(rows()[1]!).getByText(s.table.noName)).toBeInTheDocument();
    expect(svc.listContacts).toHaveBeenCalledWith(EMPTY_PLATFORM_FILTERS, null);
  });

  it('rótulo oculto da coluna de abrir mede 1 px (sx `1` = 100% e alargava a página)', async () => {
    svc.listContacts.mockResolvedValue({ items: [contact('1')], nextCursor: null });
    page();
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByText(s.table.open)).toHaveStyle({ width: '1px', height: '1px' });
  });

  it('"carregar mais" manda só o nextCursor com os mesmos filtros', async () => {
    svc.listContacts
      .mockResolvedValueOnce({ items: [contact('1')], nextCursor: 'c-1' })
      .mockResolvedValueOnce({ items: [contact('2')], nextCursor: null });
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole('button', { name: s.table.loadMore }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(svc.listContacts).toHaveBeenLastCalledWith(EMPTY_PLATFORM_FILTERS, 'c-1');
    expect(screen.queryByRole('button', { name: s.table.loadMore })).not.toBeInTheDocument();
  });

  it('cursor inválido (400) recomeça da 1ª página', async () => {
    svc.listContacts
      .mockResolvedValueOnce({ items: [contact('1')], nextCursor: 'velho' })
      .mockRejectedValueOnce({ status: 400, code: 'SAVER_CURSOR_INVALID' })
      .mockResolvedValueOnce({ items: [contact('9')], nextCursor: null });
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole('button', { name: s.table.loadMore }));
    expect(await screen.findByText(s.error.cursorRestarted)).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(svc.listContacts).toHaveBeenLastCalledWith(EMPTY_PLATFORM_FILTERS, null);
    expect(screen.getByText('Contato 9')).toBeInTheDocument();
  });

  it('trocar filtro reinicia a lista e persiste após remontar', async () => {
    svc.listContacts
      .mockResolvedValueOnce({ items: [contact('1')], nextCursor: 'c-1' })
      .mockResolvedValue({ items: [contact('5')], nextCursor: null });
    const user = userEvent.setup();
    const first = page();
    await waitFor(() => expect(rows()).toHaveLength(1));
    await user.click(screen.getByRole('combobox', { name: s.filters.tenant }));
    await user.click(await screen.findByRole('option', { name: 'Loja Verde' }));
    await waitFor(() => expect(svc.listContacts).toHaveBeenLastCalledWith({ ...EMPTY_PLATFORM_FILTERS, tenantId: 't2' }, null));
    expect(await screen.findByText('Contato 5')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: s.filters.search }), 'ana');
    await waitFor(() => expect(svc.listContacts).toHaveBeenLastCalledWith({ ...EMPTY_PLATFORM_FILTERS, tenantId: 't2', search: 'ana' }, null), { timeout: 2000 });
    first.unmount();
    page();
    await waitFor(() => expect(svc.listContacts).toHaveBeenLastCalledWith({ ...EMPTY_PLATFORM_FILTERS, tenantId: 't2', search: 'ana' }, null));
  });

  it('nome, número/LID e conta borrados pelas flags', async () => {
    window.localStorage.setItem('privacy.blur', JSON.stringify(['saverAdmin.contactNames', 'saverAdmin.contactPhones', 'saverAdmin.tenantNames']));
    svc.listContacts.mockResolvedValue({ items: [contact('1')], nextCursor: null });
    svc.getContact.mockResolvedValue({ contactId: '1', links: [] });
    page('dark');
    await waitFor(() => expect(rows()).toHaveLength(1));
    for (const text of ['Contato 1', '98765-0001', '+55', '11', 'lid-1']) {
      expect(within(rows()[0]!).getByText(text).closest('[data-blurred="true"]')).not.toBeNull();
    }
  });

  it('detalhe lista conta, grupo, data e hora; conta borrada pela flag', async () => {
    window.localStorage.setItem('privacy.blur', JSON.stringify(['saverAdmin.tenantNames']));
    svc.listContacts.mockResolvedValue({ items: [contact('1')], nextCursor: null });
    svc.getContact.mockResolvedValue({
      contactId: '1',
      links: [
        { tenantId: 't1', tenantName: 'Loja Azul', groupId: 'g1', groupName: 'Promoções', name: null, isAdmin: true, firstExtractedAt: '2026-11-02T09:00:00.000Z', lastExtractedAt: '2026-11-09T18:15:00.000Z', leftAt: null },
        { tenantId: 'desconhecido-123', tenantName: '', groupId: 'g2', groupName: 'Vendas', name: null, isAdmin: false, firstExtractedAt: '2026-11-03T09:00:00.000Z', lastExtractedAt: '2026-11-03T09:00:00.000Z', leftAt: null },
      ],
    });
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole('button', { name: s.table.openContact('Contato 1') }));
    const items = await screen.findAllByTestId('platform-contact-link');
    expect(svc.getContact).toHaveBeenCalledWith('1');
    expect(within(items[0]!).getByText('Loja Azul').closest('[data-blurred="true"]')).not.toBeNull();
    expect(within(items[0]!).getByText('Promoções')).toBeInTheDocument();
    expect(within(items[0]!).getByText(formatDateTime('2026-11-09T18:15:00.000Z')!)).toBeInTheDocument();
    expect(within(items[1]!).getByText(s.detail.unknownTenant('desconhecido-123'))).toBeInTheDocument();
  });

  it.each(['light', 'dark'] as const)('contas do filtro vêm da API por cursor, sem as contas do usuário (%s)', async (mode) => {
    svc.listContacts.mockResolvedValue({ items: [contact('1')], nextCursor: null });
    svc.listTenants
      .mockResolvedValueOnce({ items: [{ id: 'tx', name: 'Conta Externa' }], nextCursor: 'tc-1' })
      .mockResolvedValueOnce({ items: [{ id: 'ty', name: 'Outra Conta' }], nextCursor: null });
    window.localStorage.setItem('privacy.blur', JSON.stringify(['saverAdmin.tenantNames']));
    const user = userEvent.setup();
    page(mode);
    await waitFor(() => expect(rows()).toHaveLength(1));
    await user.click(screen.getByRole('combobox', { name: s.filters.tenant }));
    const ext = await screen.findByRole('option', { name: 'Conta Externa' });
    expect(within(ext).getByText('Conta Externa').closest('[data-blurred="true"]')).not.toBeNull();
    await user.click(screen.getByRole('option', { name: s.filters.tenantsMore }));
    expect(svc.listTenants).toHaveBeenLastCalledWith('tc-1');
    expect(svc.listContacts).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('combobox', { name: s.filters.tenant }));
    await user.click(await screen.findByRole('option', { name: 'Outra Conta' }));
    await waitFor(() => expect(svc.listContacts).toHaveBeenLastCalledWith({ ...EMPTY_PLATFORM_FILTERS, tenantId: 'ty' }, null));
    expect(screen.queryByRole('option', { name: s.filters.tenantsMore })).not.toBeInTheDocument();
    expect(useTenant).not.toHaveBeenCalled();
  });

  it('erro ao carregar as contas: item de tentar de novo', async () => {
    svc.listContacts.mockResolvedValue({ items: [contact('1')], nextCursor: null });
    svc.listTenants.mockRejectedValueOnce({ status: 500 }).mockResolvedValueOnce({ items: [{ id: 't9', name: 'Loja Nova' }], nextCursor: null });
    const user = userEvent.setup();
    page();
    await waitFor(() => expect(svc.listTenants).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('combobox', { name: s.filters.tenant }));
    await user.click(await screen.findByRole('option', { name: s.filters.tenantsError }));
    await user.click(screen.getByRole('combobox', { name: s.filters.tenant }));
    expect(await screen.findByRole('option', { name: 'Loja Nova' })).toBeInTheDocument();
    expect(svc.listTenants).toHaveBeenLastCalledWith(null);
  });

  it('estado vazio sem filtros e com filtros', async () => {
    svc.listContacts.mockResolvedValue({ items: [], nextCursor: null });
    const user = userEvent.setup();
    page();
    expect(await screen.findByText(s.empty.title)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: s.export.button })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: s.filters.tenant }));
    await user.click(await screen.findByRole('option', { name: 'Loja Azul' }));
    expect(await screen.findByText(s.empty.filteredTitle)).toBeInTheDocument();
  });

  it('erro de carga mostra mensagem e tenta de novo', async () => {
    svc.listContacts.mockRejectedValueOnce({ status: 500, code: 'INTERNAL' }).mockResolvedValue({ items: [contact('1')], nextCursor: null });
    const user = userEvent.setup();
    page('dark');
    expect(await screen.findByText(s.error.title)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: s.error.retry }));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it('exportar CSV baixa o Blob com os filtros atuais', async () => {
    svc.listContacts.mockResolvedValue({ items: [contact('1')], nextCursor: null });
    svc.exportContacts.mockResolvedValue({ blob: new Blob(['a;b']), filename: 'base.csv' });
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    page();
    await waitFor(() => expect(rows()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: s.export.button }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(svc.exportContacts).toHaveBeenCalledWith(EMPTY_PLATFORM_FILTERS, s.export.fallbackName);
    expect(create).toHaveBeenCalled();
    expect(await screen.findByText(s.export.done)).toBeInTheDocument();
    click.mockRestore();
  });
});

describe('acesso só de super admin', () => {
  it('item de menu ausente para quem não é super admin', () => {
    const paths = (isSuperAdmin: boolean) =>
      buildNavigation({ isSuperAdmin, offerHunterVisible: false, saverVisible: true, products: LEGACY_PRODUCTS }).platform.map((l) => l.path);
    expect(paths(false)).not.toContain(SAVER_ADMIN_PATH);
    expect(paths(true)).toContain(SAVER_ADMIN_PATH);
  });

  it('rota redireciona quem não é super admin', () => {
    auth.user = { isSuperAdmin: false };
    renderWithTheme(
      <PrivacyProvider>
        <MemoryRouter initialEntries={[SAVER_ADMIN_PATH]}>
          <Routes>
            <Route path="/" element={<p>inicio</p>} />
            <Route element={<SuperAdminRoute />}><Route path={SAVER_ADMIN_PATH} element={<PlatformContactsPage />} /></Route>
          </Routes>
        </MemoryRouter>
      </PrivacyProvider>,
    );
    expect(screen.getByText('inicio')).toBeInTheDocument();
    expect(svc.listContacts).not.toHaveBeenCalled();
  });
});
