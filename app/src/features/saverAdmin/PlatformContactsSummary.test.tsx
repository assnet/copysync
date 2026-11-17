import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithTheme } from '@/test/renderWithTheme';
import { PrivacyProvider } from '@/features/privacy';

const svc = vi.hoisted(() => ({ listContacts: vi.fn(), getContact: vi.fn(), exportContacts: vi.fn(), listTenants: vi.fn(), getSummary: vi.fn() }));
vi.mock('@/services/saverAdmin.service', () => ({ saverAdminService: svc }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ tenants: [] }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { isSuperAdmin: true } }) }));

import { PlatformContactsFooter } from './PlatformContactsFooter';
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
  svc.listTenants.mockResolvedValue({ items: [{ id: 't1', name: 'Loja Azul' }, { id: 't2', name: 'Loja Verde' }], nextCursor: null });
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
    expect(await screen.findByText(s.filters.customDdiIncomplete)).toBeInTheDocument();
    await user.type(input, '3');
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, ddi: '353' }), { timeout: 2000 });
    expect(svc.listContacts).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(s.filters.customDdiIncomplete)).not.toBeInTheDocument();

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

  it('DDI digitado é aplicado sobre os filtros mais recentes: conta escolhida na janela de 400 ms continua', async () => {
    page();
    await waitFor(() => expect(svc.listTenants).toHaveBeenCalled());
    await waitFor(() => expect(svc.listContacts).toHaveBeenCalledTimes(1));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: s.filters.ddi }));
    fireEvent.click(await screen.findByRole('option', { name: s.filters.otherDdi }));
    fireEvent.change(screen.getByRole('textbox', { name: s.filters.customDdi }), { target: { value: '353' } });
    // Antes de o timer do DDI disparar, a conta muda.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: s.filters.tenant }));
    fireEvent.click(await screen.findByRole('option', { name: 'Loja Verde' }));
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, tenantId: 't2' }));
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, tenantId: 't2', ddi: '353' }), { timeout: 2000 });
    expect(JSON.parse(window.sessionStorage.getItem('ui.saverAdmin.filters')!).d).toMatchObject({ tenantId: 't2', ddi: '353' });
  });

  it('código pela metade some ao sair do campo e com "Limpar filtros"; nada de texto nem aviso órfão', async () => {
    window.sessionStorage.setItem('ui.saverAdmin.filters', JSON.stringify({ v: 1, d: { ...EMPTY_PLATFORM_FILTERS, tenantId: 't1', ddi: '353' } }));
    const user = userEvent.setup();
    page();
    const input = await screen.findByRole('textbox', { name: s.filters.customDdi });
    expect(input).toHaveValue('353');
    await user.type(input, '{Backspace}');
    expect(await screen.findByText(s.filters.customDdiIncomplete)).toBeInTheDocument();
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, tenantId: 't1' }), { timeout: 2000 });
    await user.click(screen.getByRole('button', { name: s.filters.clear }));
    await waitFor(() => expect(lastFilters()).toEqual(EMPTY_PLATFORM_FILTERS));
    expect(screen.queryByText(s.filters.customDdiIncomplete)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('35')).not.toBeInTheDocument();
  });

  it('país da lista digitado em "Outro código": o campo só vira seletor depois de perder o foco', async () => {
    const user = userEvent.setup();
    page();
    await waitFor(() => expect(svc.listContacts).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('combobox', { name: s.filters.ddi }));
    await user.click(await screen.findByRole('option', { name: s.filters.otherDdi }));
    const input = screen.getByRole('textbox', { name: s.filters.customDdi });
    await user.type(input, '55');
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, ddi: '55' }), { timeout: 2000 });
    expect(screen.getByRole('textbox', { name: s.filters.customDdi })).toHaveValue('55');
    await user.click(screen.getByRole('textbox', { name: s.filters.search }));
    expect(await screen.findByRole('combobox', { name: s.filters.ddi })).toHaveTextContent('+55 Brasil');
  });

  it('valor inválido salvo no navegador não chega à API', async () => {
    window.sessionStorage.setItem('ui.saverAdmin.filters', JSON.stringify({ v: 1, d: { ...EMPTY_PLATFORM_FILTERS, ddi: '5', ddd: 'x1' } }));
    const { toPlatformFilterParams } = await vi.importActual<typeof import('@/services/saverAdmin.service')>('@/services/saverAdmin.service');
    expect(toPlatformFilterParams({ ...EMPTY_PLATFORM_FILTERS, ddi: '5', ddd: '11' })).toEqual({});
    expect(toPlatformFilterParams({ ...EMPTY_PLATFORM_FILTERS, ddi: '551' })).toEqual({});
    expect(toPlatformFilterParams({ ...EMPTY_PLATFORM_FILTERS, ddi: '55', ddd: 'x1' })).toEqual({ ddi: '55' });
    expect(toPlatformFilterParams({ ...EMPTY_PLATFORM_FILTERS, ddi: '55', ddd: '119' })).toEqual({ ddi: '55' });
  });
});

describe('resumo e lista coerentes durante a troca de filtro', () => {
  it('enquanto a contagem nova carrega: barras e notas seguem as do resumo anterior e o rodapé não mostra total velho', async () => {
    let release!: (v: typeof BR_SUMMARY) => void;
    svc.getSummary.mockReset();
    svc.getSummary
      .mockResolvedValueOnce(SUMMARY)
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    page();
    expect(await screen.findByText(s.table.showing('2', '4.210'))).toBeInTheDocument();
    await user.click((await screen.findAllByTestId('summary-bar'))[0]!);
    await waitFor(() => expect(lastFilters()).toEqual({ ...EMPTY_PLATFORM_FILTERS, ddi: '55' }));
    await waitFor(() => expect(svc.getSummary).toHaveBeenCalledTimes(2));

    // Resumo antigo na tela, inteiro: países (não DDD), sem "nenhum telefone", nota "sem filtros".
    expect(screen.getByText(s.summary.ddiTitle)).toBeInTheDocument();
    expect(screen.queryByText(s.summary.dddTitle)).not.toBeInTheDocument();
    expect(screen.queryByText(s.summary.distributionEmpty)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('summary-bar')).toHaveLength(3);
    expect(tile('summary-filtered').getByText(s.summary.noFilters)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: s.summary.label })).toHaveAttribute('aria-busy', 'true');
    // Rodapé: lista nova sem total (o 4.210 era dos filtros antigos).
    await waitFor(() => expect(screen.getByText(new RegExp(s.table.shown(2)))).toBeInTheDocument());
    expect(screen.queryByText(s.table.showing('2', '4.210'))).not.toBeInTheDocument();

    release(BR_SUMMARY);
    expect(await screen.findByText(s.summary.dddTitle)).toBeInTheDocument();
    expect(await screen.findByText(s.table.showing('2', '3.600'))).toBeInTheDocument();
    expect(tile('summary-filtered').getByText(s.summary.shareOfBase('2,8%'))).toBeInTheDocument();
  });

  it('um só anúncio por troca de filtro: o rodapé é a única região viva', async () => {
    page();
    expect(await screen.findByText(s.table.showing('2', '4.210'))).toBeInTheDocument();
    expect(screen.queryAllByRole('status')).toHaveLength(0);
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it('nome acessível da barra: ação + contagem no plural certo, sem vírgula solta; igual ativa ou não', async () => {
    svc.getSummary.mockReset();
    svc.getSummary.mockImplementation(async (f: { ddi: string }) => ({
      total: 9, filtered: f.ddi ? 1 : 2, withPhone: f.ddi ? 1 : 2, lidOnly: 0, topDdi: [{ ddi: '351', count: 1 }, { ddi: '55', count: 1 }], topDdd: [], ddiBase: 0, dddBase: 0,
    }));
    const user = userEvent.setup();
    page();
    const name = `${s.summary.applyDdi('Portugal', '351')}. 1 contato`;
    const bar = await screen.findByRole('button', { name });
    expect(bar).toHaveAttribute('aria-pressed', 'false');
    await user.click(bar);
    await waitFor(() => expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true'));
  });
});

describe('PlatformContactsFooter', () => {
  const footer = (props: Partial<Parameters<typeof PlatformContactsFooter>[0]>) =>
    renderWithTheme(<PlatformContactsFooter shown={50} total={null} hasMore loadingMore={false} onLoadMore={() => {}} {...props} />);

  it('sem total (indicadores fora): só a quantidade exibida, sem barra', () => {
    footer({});
    expect(screen.getByText(s.table.shown(50))).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: s.table.loadMore })).toBeInTheDocument();
  });

  it('com total: "Mostrando X de Y" e progresso; total menor que o exibido nunca vira "60 de 50"; fim da lista', () => {
    footer({ shown: 50, total: 200 });
    expect(screen.getByText(s.table.showing('50', '200'))).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    document.body.innerHTML = '';
    footer({ shown: 60, total: 50, hasMore: false });
    expect(screen.getByText(`${s.table.showing('60', '60')} · ${s.table.end}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: s.table.loadMore })).not.toBeInTheDocument();
  });
});
