import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';

const svc = vi.hoisted(() => ({ listContacts: vi.fn(), getContact: vi.fn(), exportContacts: vi.fn(), listTenants: vi.fn(), getSummary: vi.fn() }));
vi.mock('@/services/saverAdmin.service', () => ({ saverAdminService: svc }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenants: [] }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { isSuperAdmin: true } }) }));

import { PlatformContactsPage } from './PlatformContactsPage';
import { saverAdminStrings as s } from './strings';
import { EMPTY_PLATFORM_FILTERS } from './types';

const contact = (id: string) => ({
  id, name: `Contato ${id}`, phone: `551198765000${id}`, lid: null, tenantCount: 1, groupCount: 1,
  firstSeenAt: '2026-11-01T10:00:00.000Z', lastSeenAt: '2026-11-10T12:30:00.000Z',
  firstExtractedAt: '2026-11-01T10:00:00.000Z', lastExtractedAt: '2026-11-10T12:30:00.000Z',
});
const SUMMARY = { total: 128431, filtered: 4210, withPhone: 3900, lidOnly: 310, topDdi: [{ ddi: '55', count: 3600 }, { ddi: '351', count: 210 }, { ddi: '353', count: 90 }], topDdd: [], ddiBase: 3900, dddBase: 0 };
const BR_SUMMARY = { ...SUMMARY, filtered: 3600, withPhone: 3600, lidOnly: 0, dddBase: 3600, topDdd: [{ ddd: '11', count: 2000 }, { ddd: '21', count: 900 }] };
const page = (mode: 'light' | 'dark' = 'light') =>
  renderWithTheme(<PrivacyProvider><MemoryRouter><PlatformContactsPage /></MemoryRouter></PrivacyProvider>, mode);
const tile = (id: string) => within(screen.getByTestId(id));
const lastFilters = () => svc.listContacts.mock.lastCall![0];

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  svc.listTenants.mockResolvedValue({ items: [], nextCursor: null });
  svc.listContacts.mockResolvedValue({ items: [contact('1'), contact('2')], nextCursor: 'c-1' });
  svc.getSummary.mockImplementation(async (f: { ddi: string }) => (f.ddi === '55' ? BR_SUMMARY : SUMMARY));
});

describe('indicadores da base', () => {
  it.each(['light', 'dark'] as const)('total, encontrados, com telefone e só LID em pt-BR; rodapé "Mostrando X de Y" (%s)', async (mode) => {
    page(mode);
    expect(await tile('summary-total').findByText('128.431')).toBeInTheDocument();
    expect(tile('summary-filtered').getByText('4.210')).toBeInTheDocument();
    expect(tile('summary-filtered').getByText(s.summary.noFilters)).toBeInTheDocument();
    expect(tile('summary-with-phone').getByText('3.900')).toBeInTheDocument();
    expect(tile('summary-lid-only').getByText('310')).toBeInTheDocument();
    expect(svc.getSummary).toHaveBeenCalledWith(EMPTY_PLATFORM_FILTERS);
    expect(await screen.findByText(s.table.showing('2', '4.210'))).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: s.table.progress })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('button', { name: s.table.loadMore })).toBeInTheDocument();
  });

  it('clicar na barra do país filtra por DDI; com o Brasil, as barras viram DDD e filtram por DDD', async () => {
    const user = userEvent.setup();
    page();
    const bars = await screen.findAllByTestId('summary-bar');
    expect(bars).toHaveLength(3);
    expect(within(bars[1]!).getByText('Portugal')).toBeInTheDocument();
    expect(within(bars[2]!).getByText(s.regions.unknownCountry)).toBeInTheDocument();
    await user.click(bars[0]!);
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, ddi: '55' }));
    expect(await screen.findByText(s.summary.dddTitle)).toBeInTheDocument();
    expect(tile('summary-filtered').getByText(s.summary.shareOfBase('2,8%'))).toBeInTheDocument();

    const ddd = await screen.findAllByTestId('summary-bar');
    expect(within(ddd[1]!).getByText('Rio de Janeiro, RJ')).toBeInTheDocument();
    await user.click(ddd[1]!);
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, ddi: '55', ddd: '21' }));
    expect(svc.getSummary).toHaveBeenLastCalledWith({ ...EMPTY_PLATFORM_FILTERS, ddi: '55', ddd: '21' });
    // Barra ativa: novo clique remove o filtro.
    await waitFor(() => expect(screen.getAllByTestId('summary-bar')[1]).toHaveAttribute('aria-pressed', 'true'));
    await user.click(screen.getAllByTestId('summary-bar')[1]!);
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, ddi: '55' }));
  });

  it('falha dos indicadores: aviso discreto com tentar de novo; lista e rodapé seguem', async () => {
    svc.getSummary.mockRejectedValueOnce({ status: 503, code: 'SAVER_SUMMARY_UNAVAILABLE' });
    const user = userEvent.setup();
    page('dark');
    expect(await screen.findByText(s.summary.error)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId('platform-contact-row')).toHaveLength(2));
    expect(screen.getByText(new RegExp(s.table.shown(2)))).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: s.table.progress })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: s.summary.retry }));
    expect(await tile('summary-total').findByText('128.431')).toBeInTheDocument();
  });

  it('sem telefone nos encontrados: distribuição vazia', async () => {
    svc.getSummary.mockResolvedValue({ total: 5, filtered: 0, withPhone: 0, lidOnly: 0, topDdi: [], topDdd: [], ddiBase: 0, dddBase: 0 });
    page();
    expect(await screen.findByText(s.summary.distributionEmpty)).toBeInTheDocument();
    expect(screen.queryAllByTestId('summary-bar')).toHaveLength(0);
  });
});

describe('filtros por país (DDI) e DDD', () => {
  it('DDD só habilita com o Brasil; trocar o país limpa o DDD; filtros persistem', async () => {
    const user = userEvent.setup();
    const first = page();
    await waitFor(() => expect(svc.listContacts).toHaveBeenCalled());
    const dddField = () => screen.getByRole('combobox', { name: s.filters.ddd });
    expect(dddField()).toHaveAttribute('aria-disabled', 'true');

    await user.click(screen.getByRole('combobox', { name: s.filters.ddi }));
    const options = await screen.findAllByRole('option');
    expect(options[1]).toHaveAccessibleName('+55 Brasil');
    await user.click(options[1]!);
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, ddi: '55' }));
    expect(dddField()).not.toHaveAttribute('aria-disabled', 'true');

    await user.click(dddField());
    await user.click(await screen.findByRole('option', { name: '11 São Paulo, SP' }));
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, ddi: '55', ddd: '11' }));

    first.unmount();
    page();
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, ddi: '55', ddd: '11' }));

    await user.click(screen.getByRole('combobox', { name: s.filters.ddi }));
    await user.click(await screen.findByRole('option', { name: '+351 Portugal' }));
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, ddi: '351' }));
    expect(dddField()).toHaveAttribute('aria-disabled', 'true');
  });

  it('"Outro código": só aplica código de país inteiro; voltar para a lista limpa', async () => {
    const user = userEvent.setup();
    page();
    await waitFor(() => expect(svc.listContacts).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('combobox', { name: s.filters.ddi }));
    await user.click(await screen.findByRole('option', { name: s.filters.otherDdi }));
    const input = screen.getByRole('textbox', { name: s.filters.customDdi });
    await user.type(input, '3a5');
    expect(input).toHaveValue('35');
    expect(await screen.findByText(s.filters.customDdiInvalid)).toBeInTheDocument();
    await user.type(input, '3');
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, ddi: '353' }), { timeout: 2000 });
    expect(svc.listContacts).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: s.filters.backToList }));
    await waitFor(() => expect(lastFilters()).toEqual(EMPTY_PLATFORM_FILTERS));
    expect(screen.getByRole('combobox', { name: s.filters.ddi })).toBeInTheDocument();
  });

  it('"Limpar filtros" zera país e DDD', async () => {
    window.sessionStorage.setItem('ui.saverAdmin.filters', JSON.stringify({ v: 1, d: { ...EMPTY_PLATFORM_FILTERS, ddi: '55', ddd: '21' } }));
    const user = userEvent.setup();
    page();
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, ddi: '55', ddd: '21' }));
    await user.click(screen.getByRole('button', { name: s.filters.clear }));
    await waitFor(() => expect(lastFilters()).toEqual(EMPTY_PLATFORM_FILTERS));
  });
});
