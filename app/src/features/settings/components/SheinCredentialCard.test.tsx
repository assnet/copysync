import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AffiliateCredentialItem, MarketplaceAvailability } from '@/types/api.types';
import type { UseExtensionResult } from '@/features/extension/hooks/useExtension';
import { renderWithTheme } from '@/test/renderWithTheme';

const service = vi.hoisted(() => ({ acceptRisk: vi.fn() }));
vi.mock('@/services/affiliateCredential.service', () => ({ affiliateCredentialService: service }));

import { AFFILIATE_PROVIDERS } from '../affiliateProviders';
import { SheinCredentialCard, SHEIN_WAIT_POLL_MS } from './SheinCredentialCard';

const spec = AFFILIATE_PROVIDERS.find((p) => p.provider === 'SHEIN')!;
const ACCEPTED_AT = '2026-11-10T15:30:00.000Z';

const avail = (over: Partial<MarketplaceAvailability> = {}): MarketplaceAvailability => ({
  enabled: true, plans: ['max'], riskNotice: { version: '2026-11-10', acceptedAt: null, acceptedByMe: false }, ...over,
});
const accepted = () => avail({ riskNotice: { version: '2026-11-10', acceptedAt: ACCEPTED_AT, acceptedByMe: true } });
const item = (over: Partial<AffiliateCredentialItem> = {}): AffiliateCredentialItem => ({
  provider: 'SHEIN', status: 'ACTIVE', publicIdentifier: '998877', publicIdentifierMasked: '••77', hasSecret: false,
  hasSession: true, sessionSyncedAt: ACCEPTED_AT, lastValidatedAt: null, rejectedAt: null, rejectedCode: null,
  updatedAt: ACCEPTED_AT, ...over,
});

function makeExt(over: Partial<UseExtensionResult> = {}): UseExtensionResult {
  return {
    status: 'connected', handshake: null, mlStatus: null, mlCredential: null, sheinStatus: null,
    credentials: { ml: null, shein: null }, refreshSeq: 1, error: null, loading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn(), sync: vi.fn().mockResolvedValue({ result: 'UPDATED' }), syncMl: vi.fn(),
    consent: vi.fn().mockResolvedValue(undefined),
    requestAccess: vi.fn().mockResolvedValue({ pending: true, until: new Date(Date.now() + 600_000).toISOString(), permission: 'missing' }),
    readSheinStatus: vi.fn().mockResolvedValue({ permission: 'missing', pending: true, loggedIn: false, syncStatus: 'idle' }),
    disconnect: vi.fn(), disconnectMl: vi.fn(),
    supports: (cap: string) => cap === 'shein.session',
    revokeSession: vi.fn(),
    ...over,
  } as UseExtensionResult;
}

function setup(props: Partial<Parameters<typeof SheinCredentialCard>[0]> = {}) {
  const handlers = {
    onReload: vi.fn().mockResolvedValue(undefined),
    onDisconnect: vi.fn().mockResolvedValue(undefined),
    onStatusChange: vi.fn(),
    onOpenLink: vi.fn(),
  };
  const all = { spec, availability: avail(), ext: makeExt(), canAcceptRisk: true, ...handlers, ...props };
  const view = renderWithTheme(<MemoryRouter><SheinCredentialCard {...all} /></MemoryRouter>);
  const rerender = (next: Partial<typeof all>) =>
    view.rerender(<MemoryRouter><SheinCredentialCard {...all} {...next} /></MemoryRouter>);
  return { ...all, view, rerender };
}

const banner = () => screen.queryByText('Uso por sua conta e risco');

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('SheinCredentialCard', () => {
  it('travado pelo plano: selos da lista da API, link para planos e sem faixa de aviso', () => {
    setup({ availability: avail({ enabled: false, plans: ['pro', 'max'] }) });
    expect(screen.getByText('PRO')).toBeInTheDocument();
    expect(screen.getByText('MAX')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver planos' })).toBeInTheDocument();
    expect(banner()).not.toBeInTheDocument();
  });

  it('faixa de aviso fixa em todo estado com plano liberado', () => {
    const cases: Array<Partial<Parameters<typeof SheinCredentialCard>[0]>> = [
      { ext: makeExt({ status: 'not_detected' }) },
      { ext: makeExt({ supports: () => false }) },
      { ext: makeExt({ status: 'detected' }) },
      {},
      { item: item(), availability: accepted() },
      { item: item({ rejectedAt: ACCEPTED_AT }), availability: accepted() },
      { item: item() },
    ];
    for (const c of cases) {
      const { view } = setup(c);
      expect(banner()).toBeInTheDocument();
      view.unmount();
    }
  });

  it('"Conectar Shein" abre o diálogo e só chama /consent depois do aceite, na ordem', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    service.acceptRisk.mockImplementation(async () => { order.push('risk'); return { acceptedAt: ACCEPTED_AT, noticeVersion: '2026-11-10' }; });
    const ext = makeExt({ consent: vi.fn(async () => { order.push('consent'); }) });
    setup({ ext });

    await user.click(screen.getByRole('button', { name: 'Conectar Shein' }));
    const dialog = screen.getByRole('dialog');
    expect(ext.consent).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole('button', { name: 'Aceitar e conectar' });
    expect(confirm).toBeDisabled();

    await user.click(within(dialog).getByRole('checkbox', { name: 'Li e assumo o risco' }));
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(ext.requestAccess).toHaveBeenCalledWith('shein'));
    expect(order).toEqual(['risk', 'consent']);
    expect(service.acceptRisk).toHaveBeenCalledWith('SHEIN', { noticeVersion: '2026-11-10', locale: 'pt-BR' });
    expect(screen.getByText('Falta um clique na extensão')).toBeInTheDocument();
  });

  it('com aceite vigente pula o diálogo e vai direto ao /consent', async () => {
    const user = userEvent.setup();
    const ext = makeExt();
    setup({ ext, availability: accepted() });
    await user.click(screen.getByRole('button', { name: 'Conectar Shein' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(ext.consent).toHaveBeenCalledWith('shein'));
    expect(service.acceptRisk).not.toHaveBeenCalled();
  });

  it('caixa de aceite não sobrevive a reload (remontagem começa desmarcada)', async () => {
    const user = userEvent.setup();
    const keys = () => [...Object.keys(sessionStorage), ...Object.keys(localStorage)].sort();
    const before = keys();
    const first = setup();
    await user.click(screen.getByRole('button', { name: 'Conectar Shein' }));
    await user.click(screen.getByRole('checkbox', { name: 'Li e assumo o risco' }));
    expect(screen.getByRole('checkbox', { name: 'Li e assumo o risco' })).toBeChecked();
    // Nada do diálogo de aceite foi gravado em sessionStorage/localStorage.
    expect(keys()).toEqual(before);
    expect(keys().some((k) => /risk|aceite|accept|notice|shein/i.test(k))).toBe(false);
    first.view.unmount();

    setup();
    await user.click(screen.getByRole('button', { name: 'Conectar Shein' }));
    expect(screen.getByRole('checkbox', { name: 'Li e assumo o risco' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Aceitar e conectar' })).toBeDisabled();
  });

  it('operador vê o texto, não consegue confirmar e recebe a dica', async () => {
    const user = userEvent.setup();
    setup({ canAcceptRisk: false });
    await user.click(screen.getByRole('button', { name: 'Conectar Shein' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/proíbem o uso de bots/)).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Aceitar e conectar' })).toBeDisabled();
    expect(within(dialog).getByText('Só um administrador desta conta pode aceitar o aviso.')).toBeInTheDocument();
  });

  it('409 de aviso desatualizado: recarrega e troca o aceite por "Recarregar página" (sem loop)', async () => {
    const user = userEvent.setup();
    service.acceptRisk.mockRejectedValue(Object.assign(new Error('x'), { code: 'MARKETPLACE_RISK_NOTICE_OUTDATED' }));
    const s = setup();
    await user.click(screen.getByRole('button', { name: 'Conectar Shein' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Aceitar e conectar' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText(/O texto do aviso de risco foi atualizado/)).toBeInTheDocument();
    expect(s.onReload).toHaveBeenCalled();
    expect(s.ext.consent).not.toHaveBeenCalled();
    // Sem caixa nem botão de aceite: não há como reenviar a versão velha.
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Aceitar e conectar' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Recarregar página' })).toBeInTheDocument();
    expect(service.acceptRisk).toHaveBeenCalledTimes(1);
  });

  it('versão da API diferente da do painel: sem aceite, só "Recarregar página"', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
    try {
      setup({ availability: avail({ riskNotice: { version: '2026-12-01', acceptedAt: null, acceptedByMe: false } }) });
      await user.click(screen.getByRole('button', { name: 'Conectar Shein' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText(/O texto do aviso de risco foi atualizado/)).toBeInTheDocument();
      expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: 'Aceitar e conectar' })).not.toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Recarregar página' }));
      expect(reload).toHaveBeenCalledTimes(1);
      expect(service.acceptRisk).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('riskNotice null não pula o aceite: abre o diálogo e não chama /consent', async () => {
    const user = userEvent.setup();
    const s = setup({ availability: avail({ riskNotice: null }) });
    await user.click(screen.getByRole('button', { name: 'Conectar Shein' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Li e assumo o risco' })).toBeInTheDocument();
    expect(s.ext.consent).not.toHaveBeenCalled();
  });

  it('riskNotice null com conta conectada pede reaceite', () => {
    setup({ item: item(), availability: avail({ riskNotice: null }) });
    expect(screen.getByText('O aviso de risco mudou')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sincronizar agora' })).not.toBeInTheDocument();
  });

  it('mostra data e hora do aceite no card, com "por você"', () => {
    setup({ availability: accepted(), item: item() });
    expect(screen.getByText(/^Aceito em .+ por você$/)).toBeInTheDocument();
  });

  it('versão nova com conta conectada pede reaceite', async () => {
    const user = userEvent.setup();
    setup({ item: item(), availability: avail({ riskNotice: { version: '2026-12-01', acceptedAt: null, acceptedByMe: false } }) });
    expect(screen.getByText('O aviso de risco mudou')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conectar Shein' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ler e aceitar o aviso' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('conectado: ID, "Sincronizar agora" e "Desconectar"/lixeira pela rota da extensão', async () => {
    const user = userEvent.setup();
    const s = setup({ item: item(), availability: accepted() });
    // Só o ID mascarado vai ao DOM.
    expect(screen.getByText('••77')).toBeInTheDocument();
    expect(screen.queryByText('998877')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sincronizar agora' }));
    await waitFor(() => expect(s.ext.sync).toHaveBeenCalledWith('shein'));

    await user.click(screen.getByRole('button', { name: 'Desconectar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desconectar' }));
    await waitFor(() => expect(s.onDisconnect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Remover' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desconectar' }));
    await waitFor(() => expect(s.onDisconnect).toHaveBeenCalledTimes(2));
  });

  it('extensão sem vínculo: instrução de vincular e nunca chama /consent', async () => {
    const user = userEvent.setup();
    const s = setup({ ext: makeExt({ status: 'detected' }), availability: accepted() });
    expect(screen.getByText('Vincule a extensão a este painel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conectar Shein' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vincular extensão' }));
    expect(s.onOpenLink).toHaveBeenCalled();
    expect(s.ext.consent).not.toHaveBeenCalled();
  });

  it('404 no clique leva a "sem vínculo" e some após o próximo refresh()', async () => {
    const user = userEvent.setup();
    const ext = makeExt({ consent: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'SESSION_NOT_FOUND' })) });
    const s = setup({ ext, availability: accepted() });
    await user.click(screen.getByRole('button', { name: 'Conectar Shein' }));
    expect(await screen.findByText('Vincule a extensão a este painel')).toBeInTheDocument();

    s.rerender({ ext: { ...ext, refreshSeq: 2 } });
    expect(screen.queryByText('Vincule a extensão a este painel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conectar Shein' })).toBeInTheDocument();
  });

  it('após o clique no ícone chega a "conectado" sozinho (consulta shein.status com setTimeout)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const readSheinStatus = vi.fn()
      .mockResolvedValueOnce({ permission: 'missing', pending: true, loggedIn: false, syncStatus: 'idle' })
      .mockResolvedValue({ permission: 'granted', pending: false, loggedIn: true, syncStatus: 'ok' });
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const s = setup({ ext: makeExt({ readSheinStatus }), availability: accepted() });

    await user.click(screen.getByRole('button', { name: 'Conectar Shein' }));
    expect(await screen.findByText('Falta um clique na extensão')).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(SHEIN_WAIT_POLL_MS); });
    expect(readSheinStatus).toHaveBeenCalledTimes(1);
    expect(s.onReload).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(SHEIN_WAIT_POLL_MS); });
    await waitFor(() => expect(s.onReload).toHaveBeenCalled());
    expect(screen.getByText('Sessão da Shein sincronizada.')).toBeInTheDocument();

    // Parou de consultar
    await act(async () => { await vi.advanceTimersByTimeAsync(SHEIN_WAIT_POLL_MS * 3); });
    expect(readSheinStatus).toHaveBeenCalledTimes(2);
    expect(setIntervalSpy.mock.calls.some(([, ms]) => ms === SHEIN_WAIT_POLL_MS)).toBe(false);
  });

  it('pendência expirada para a consulta e volta a "pronto" com aviso', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const readSheinStatus = vi.fn().mockResolvedValue({ permission: 'missing', pending: false, loggedIn: false, syncStatus: 'idle' });
    setup({ ext: makeExt({ readSheinStatus }), availability: accepted() });

    await user.click(screen.getByRole('button', { name: 'Conectar Shein' }));
    await screen.findByText('Falta um clique na extensão');
    await act(async () => { await vi.advanceTimersByTimeAsync(SHEIN_WAIT_POLL_MS); });

    expect(await screen.findByText(/O pedido de acesso expirou ou foi negado/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conectar Shein' })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(SHEIN_WAIT_POLL_MS * 3); });
    expect(readSheinStatus).toHaveBeenCalledTimes(1);
  });
  it('remontagem com pendência na extensão retoma a espera sem persistir nada', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const readSheinStatus = vi.fn().mockResolvedValue({ permission: 'granted', pending: false, loggedIn: true, syncStatus: 'ok' });
    const sheinStatus = { permission: 'missing' as const, pending: true, loggedIn: false, syncStatus: 'idle' as const };
    const s = setup({ ext: makeExt({ readSheinStatus, sheinStatus }), availability: accepted() });

    expect(await screen.findByText('Falta um clique na extensão')).toBeInTheDocument();
    expect(s.ext.consent).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(SHEIN_WAIT_POLL_MS); });
    await waitFor(() => expect(s.onReload).toHaveBeenCalled());
    expect(screen.getByText('Sessão da Shein sincronizada.')).toBeInTheDocument();
  });

  it('sem pendência na extensão a montagem fica em "pronto"', () => {
    const sheinStatus = { permission: 'missing' as const, pending: false, loggedIn: false, syncStatus: 'idle' as const };
    setup({ ext: makeExt({ sheinStatus }), availability: accepted() });
    expect(screen.queryByText('Falta um clique na extensão')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conectar Shein' })).toBeInTheDocument();
  });

  it('erro na consulta da espera encerra com aviso, sem consultar de novo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const readSheinStatus = vi.fn().mockRejectedValue(new Error('canal'));
    setup({ ext: makeExt({ readSheinStatus }), availability: accepted() });

    await user.click(screen.getByRole('button', { name: 'Conectar Shein' }));
    await screen.findByText('Falta um clique na extensão');
    await act(async () => { await vi.advanceTimersByTimeAsync(SHEIN_WAIT_POLL_MS); });
    expect(await screen.findByText(/O pedido de acesso expirou ou foi negado/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(SHEIN_WAIT_POLL_MS * 3); });
    expect(readSheinStatus).toHaveBeenCalledTimes(1);
  });
});
