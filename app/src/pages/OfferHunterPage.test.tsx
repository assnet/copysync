import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Hunt, HuntGates, HuntOptions } from '@/features/offerHunter/types';

const svc = vi.hoisted(() => ({
  getOptions: vi.fn(), getUsage: vi.fn(), getSettings: vi.fn(), list: vi.fn(), saveSettings: vi.fn(),
  pause: vi.fn(), resume: vi.fn(), remove: vi.fn(), update: vi.fn(), create: vi.fn(),
}));
vi.mock('@/services/offerHunter.service', () => ({ offerHunterService: svc }));
vi.mock('@/services/affiliateCredential.service', () => ({ affiliateCredentialService: { acceptRisk: vi.fn() } }));
vi.mock('@/services/session.service', () => ({ sessionService: { list: vi.fn().mockResolvedValue({ sessions: [] }) } }));
vi.mock('@/services/offer.service', () => ({ offerService: { listSessionGroups: vi.fn().mockResolvedValue({ groups: [], partial: false }) } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', isSuperAdmin: false } }) }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 't1', tenants: [{ id: 't1', role: 'ADMIN' }] }) }));

import { OfferHunterPage } from './OfferHunterPage';
import { offerHunterStrings as t } from '@/features/offerHunter/strings';

const OPEN: HuntGates = { plan: true, hunterEntitlement: true, credential: true, riskAccepted: true, aiAvailable: true, destination: true };
const options = (gates: Partial<HuntGates> = {}): HuntOptions => ({
  categories: [], sourceStatus: 'OK', sorts: [], commissionBands: [], presets: [],
  limits: {
    huntsMax: 5, topNMax: 5, topNDefault: 3, repeatAfterDaysMin: 1, repeatAfterDaysMax: 30, repeatAfterDaysDefault: 7,
    intervalMinutesMin: 30, intervalMinutesMax: 1440, keywordMaxLength: 60, nameMaxLength: 60, endsWithinDaysMax: 30,
  },
  gates: { ...OPEN, ...gates },
});
const hunt = (id: string, over: Partial<Hunt> = {}): Hunt => ({
  id, name: `Caçada ${id}`, status: 'ACTIVE', pauseReason: null, sort: 'RECOMMENDED', categoryId: null, commissionBand: null,
  keyword: null, filters: {
    minPriceCents: null, maxPriceCents: null, minDiscountPct: null, minCommissionPct: null, minCommissionCents: null,
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
});
