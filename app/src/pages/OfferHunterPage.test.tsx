import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Hunt, HuntGates, HuntOptions } from '@/features/offerHunter/types';

const svc = vi.hoisted(() => ({
  getOptions: vi.fn(), getProviders: vi.fn(), getUsage: vi.fn(), getSettings: vi.fn(), list: vi.fn(), saveSettings: vi.fn(),
  pause: vi.fn(), resume: vi.fn(), remove: vi.fn(), update: vi.fn(), create: vi.fn(),
}));
vi.mock('@/services/offerHunter.service', () => ({ offerHunterService: svc }));
const risk = vi.hoisted(() => ({ acceptRisk: vi.fn() }));
vi.mock('@/services/affiliateCredential.service', () => ({ affiliateCredentialService: risk }));
vi.mock('@/services/session.service', () => ({ sessionService: { list: vi.fn().mockResolvedValue({ sessions: [] }) } }));
vi.mock('@/services/offer.service', () => ({ offerService: { listSessionGroups: vi.fn().mockResolvedValue({ groups: [], partial: false }) } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', isSuperAdmin: false } }) }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 't1', tenants: [{ id: 't1', role: 'ADMIN' }] }) }));

import { OfferHunterPage } from './OfferHunterPage';
import { offerHunterStrings as t } from '@/features/offerHunter/strings';
import { fallbackCapabilities } from '@/features/offerHunter/providers';

const OPEN: HuntGates = { plan: true, hunterEntitlement: true, credential: true, riskAccepted: true, aiAvailable: true, destination: true };
const options = (gates: Partial<HuntGates> = {}): HuntOptions => ({
  provider: 'SHEIN', capabilities: fallbackCapabilities('SHEIN'), categories: [], sourceStatus: 'OK', sorts: [], commissionBands: [], presets: [],
  limits: {
    huntsMax: 5, topNMax: 5, topNDefault: 3, repeatAfterDaysMin: 1, repeatAfterDaysMax: 30, repeatAfterDaysDefault: 7,
    intervalMinutesMin: 30, intervalMinutesMax: 1440, keywordMaxLength: 60, nameMaxLength: 60, endsWithinDaysMax: 30,
  },
  gates: { ...OPEN, ...gates },
});
const hunt = (id: string, over: Partial<Hunt> = {}): Hunt => ({
  id, provider: 'SHEIN', sourceOptions: null, aiConfigured: false, aiIntent: null, name: `Caçada ${id}`, status: 'ACTIVE', pauseReason: null, sort: 'RECOMMENDED', categoryId: null, commissionBand: null,
  keyword: null, filters: {
    minPriceCents: null, maxPriceCents: null, minDiscountPct: null, minCommissionPct: null, commissionOperator: null, minCommissionCents: null,
    minRating: null, minSales: null, minReviews: null, onlyWithExtra: null, endsWithinDays: null,
  },
  aiEnabled: true, topN: 3, repeatAfterDays: 7, deliveryMode: 'REVIEW', intervalMinutes: 60, windowStartMinute: 0,
  windowEndMinute: 1440, weekdaysMask: 127, nextRunAt: null, lastRunAt: null, consecutiveFailures: 0,
  createdAt: '2026-11-12T10:00:00Z', updatedAt: '2026-11-12T10:00:00Z', ...over,
});

const renderPage = () => render(<MemoryRouter><OfferHunterPage /></MemoryRouter>);
const createButton = () => screen.getAllByRole('button', { name: t.list.create })[0]!;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  svc.getOptions.mockResolvedValue(options());
  svc.getUsage.mockResolvedValue({ used: 3, limit: 10, remaining: 7, runsToday: 2, runsMax: 48 });
  svc.getSettings.mockResolvedValue({ sessionId: null, conversationId: null, valid: false });
  svc.list.mockResolvedValue([]);
  svc.getProviders.mockRejectedValue({ code: 'UNKNOWN' });
});

describe('OfferHunterPage', () => {
  it('vazio: explica o recurso, mostra o uso do dia vindo da API e libera "Nova caçada"', async () => {
    renderPage();
    expect(await screen.findByText(t.list.emptyTitle)).toBeInTheDocument();
    expect(await screen.findByText(t.usage.finds(3, 10))).toBeInTheDocument();
    expect(screen.getByText(t.usage.runs(2, 48))).toBeInTheDocument();
    await waitFor(() => expect(createButton()).toBeEnabled());
  });

  it('lista: cartões com estado, modo e alerta de pausa automática', async () => {
    svc.list.mockResolvedValue([
      hunt('a'),
      hunt('b', { status: 'PAUSED', pauseReason: 'CREDENTIAL_REJECTED', deliveryMode: 'AUTO', aiEnabled: false }),
    ]);
    renderPage();
    const list = await screen.findByRole('list', { name: t.home.listLabel });
    expect(within(list).getAllByRole('article')).toHaveLength(2);
    expect(within(list).getByText(t.pauseReasons.CREDENTIAL_REJECTED)).toBeInTheDocument();
    expect(within(list).getByText(t.deliveryModes.AUTO.label)).toBeInTheDocument();
    expect(within(list).getByText(t.home.aiOff)).toBeInTheDocument();
    expect(within(list).getAllByRole('link', { name: t.list.open })[0]).toHaveAttribute('href', '/offer-hunter/a');
  });

  it('portão fechado: painel aparece no topo e "Nova caçada" fica desabilitado', async () => {
    svc.getOptions.mockResolvedValue(options({ riskAccepted: false }));
    renderPage();
    const panel = await screen.findByRole('region', { name: t.gatesPanel.title });
    expect(within(panel).getByText(t.gates.riskAccepted.title)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: t.gates.riskAccepted.action })).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });

  it('sem plano: só o upgrade, sem uso nem destino', async () => {
    svc.getOptions.mockResolvedValue(options({ plan: false }));
    renderPage();
    const panel = await screen.findByRole('region', { name: t.gatesPanel.title });
    expect(within(panel).getByText(t.gates.plan.title)).toBeInTheDocument();
    expect(screen.queryByText(t.destination.title)).toBeNull();
  });

  it('teto de 5 caçadas desabilita "Nova caçada"', async () => {
    svc.list.mockResolvedValue(['1', '2', '3', '4', '5'].map((id) => hunt(id)));
    renderPage();
    await screen.findAllByRole('article');
    await waitFor(() => expect(svc.getOptions).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(t.list.count(5, 5))).toBeInTheDocument());
    expect(createButton()).toBeDisabled();
  });

  it('várias lojas: painel da loja pronta, logo no cartão e trava pela loja da caçada', async () => {
    const ml: HuntGates = { ...OPEN };
    svc.getProviders.mockResolvedValue([
      { provider: 'SHEIN', credentialState: 'MISSING', gates: { ...OPEN, credential: false } },
      { provider: 'MERCADO_LIVRE', credentialState: 'OK', gates: ml },
    ]);
    svc.getOptions.mockImplementation((p: string) => Promise.resolve({ ...options(), provider: p }));
    svc.list.mockResolvedValue([
      hunt('a', { provider: 'MERCADO_LIVRE', status: 'PAUSED', pauseReason: 'USER' }),
      hunt('b', { status: 'PAUSED', pauseReason: 'USER' }),
    ]);
    renderPage();
    await waitFor(() => expect(svc.getOptions).toHaveBeenCalledWith('MERCADO_LIVRE'));
    const list = await screen.findByRole('list', { name: t.home.listLabel });
    expect(within(list).getByTestId('provider-badge-MERCADO_LIVRE')).toBeInTheDocument();
    await waitFor(() => expect(createButton()).toBeEnabled());
    const [mlSwitch, sheinSwitch] = within(list).getAllByRole('checkbox');
    expect(mlSwitch).toBeEnabled();
    expect(sheinSwitch).toBeDisabled();
  });
  it('aceite do aviso no passo 0 troca a loja da tela sem desmontar o assistente', async () => {
    let sheinRisk = false;
    svc.getProviders.mockImplementation(() => Promise.resolve([
      { provider: 'SHEIN', credentialState: 'OK', gates: { ...OPEN, riskAccepted: sheinRisk } },
      { provider: 'MERCADO_LIVRE', credentialState: 'OK', gates: OPEN },
    ]));
    svc.getOptions.mockImplementation((p: string) => Promise.resolve({ ...options(), provider: p, capabilities: fallbackCapabilities(p as 'SHEIN') }));
    risk.acceptRisk.mockImplementation(() => { sheinRisk = true; return Promise.resolve({ acceptedAt: '2026-11-13T10:00:00Z' }); });
    renderPage();
    await waitFor(() => expect(createButton()).toBeEnabled());
    fireEvent.click(createButton());
    const wizard = await screen.findByRole('dialog', { name: t.wizard.createTitle });
    fireEvent.click(await within(wizard).findByRole('button', { name: /Ler aviso: SHEIN/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: t.riskNotice.SHEIN.checkbox }));
    fireEvent.click(screen.getByRole('button', { name: t.riskNotice.SHEIN.confirm }));
    await waitFor(() => expect(svc.getOptions).toHaveBeenCalledWith('SHEIN'));
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: t.wizard.createTitle })).getByRole('radio', { name: /^SHEIN/ })).toBeEnabled());
    expect(screen.getByRole('dialog', { name: t.wizard.createTitle })).toBe(wizard);
  });

  it('lojas sem estado: o portão da tela não trava caçada de outra loja', async () => {
    svc.getOptions.mockResolvedValue(options({ riskAccepted: false }));
    svc.list.mockResolvedValue([
      hunt('a', { provider: 'MERCADO_LIVRE', status: 'PAUSED', pauseReason: 'USER' }),
      hunt('b', { status: 'PAUSED', pauseReason: 'USER' }),
    ]);
    renderPage();
    const list = await screen.findByRole('list', { name: t.home.listLabel });
    await waitFor(() => expect(within(list).getAllByRole('checkbox')[1]).toBeDisabled());
    expect(within(list).getAllByRole('checkbox')[0]).toBeEnabled();
  });

  it('resumo do cartão usa categoria e predefinição da loja da caçada (tela ML, caçada SHEIN)', async () => {
    svc.getProviders.mockResolvedValue([
      { provider: 'SHEIN', credentialState: 'MISSING', gates: { ...OPEN, credential: false } },
      { provider: 'MERCADO_LIVRE', credentialState: 'OK', gates: OPEN },
    ]);
    svc.getOptions.mockImplementation((p: string) => Promise.resolve(p === 'SHEIN'
      ? { ...options(), categories: [{ categoryId: 'c1', name: 'Vestidos' }], presets: [{ key: 'TOP_COMMISSION', definition: { source: { sort: 'RECOMMENDED', commissionBand: 'ANY' }, local: {} } }] }
      : { ...options(), provider: 'MERCADO_LIVRE', capabilities: fallbackCapabilities('MERCADO_LIVRE'), categories: [{ categoryId: 'MLB1', name: 'Calçados' }] }));
    svc.list.mockResolvedValue([hunt('a', { categoryId: 'c1' }), hunt('b', { categoryId: 'c1' })]);
    renderPage();
    const list = await screen.findByRole('list', { name: t.home.listLabel });
    expect((await within(list).findAllByText('Vestidos'))).toHaveLength(2);
    expect(within(list).getAllByText(t.presets.TOP_COMMISSION.label)).toHaveLength(2);
    expect(within(list).queryByText(t.home.categoryUnknown)).toBeNull();
    expect(svc.getOptions.mock.calls.filter(([p]) => p === 'SHEIN')).toHaveLength(1);
  });
});
