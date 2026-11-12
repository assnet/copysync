import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { HuntFind, HuntRun } from '../types';

const svc = vi.hoisted(() => ({
  getAccess: vi.fn(), listRuns: vi.fn(), listFinds: vi.fn(), approveFind: vi.fn(), dismissFind: vi.fn(),
  list: vi.fn(), pause: vi.fn(), resume: vi.fn(), create: vi.fn(),
}));
const risk = vi.hoisted(() => ({ acceptRisk: vi.fn() }));
vi.mock('@/services/offerHunter.service', () => ({ offerHunterService: svc }));
vi.mock('@/services/affiliateCredential.service', () => ({ affiliateCredentialService: risk }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 't1' }) }));

import { resetOfferHunterAccessCache, useOfferHunterAccess } from './useOfferHunterAccess';
import { useHuntFinds, useHuntRuns } from './useHuntHistory';
import { useOfferHunts } from './useOfferHunts';
import { firstClosedGate } from './useHuntInfo';
import { useHunterRiskAcceptance } from './useHunterRiskAcceptance';
import { OfferHunterRoute } from '../components/OfferHunterRoute';

const find = (id: string, over: Partial<HuntFind> = {}): HuntFind => ({
  id, huntId: 'h1', runId: 'r1', status: 'PENDING_REVIEW', goodsId: `g${id}`, title: `Item ${id}`, imageUrl: null, priceCents: 1000,
  originalPriceCents: null, discountPercent: null, commissionPercent: 10, commissionCents: 100,
  returningCommissionPercent: null, returningCommissionCents: null, extraCommissionCents: null, salesBucket: null,
  reviewsBucket: null, rating: null, score: 50, factors: [], aiReason: null, failureReason: null, offerId: null,
  createdAt: '2026-11-12T10:00:00.000Z', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  resetOfferHunterAccessCache();
});

describe('useOfferHunterAccess', () => {
  it('menu e guard dividem uma consulta; erro fecha (invisível)', async () => {
    svc.getAccess.mockResolvedValue({ visible: true });
    const a = renderHook(() => useOfferHunterAccess());
    const b = renderHook(() => useOfferHunterAccess());
    expect(a.result.current).toEqual({ visible: false, loading: true });
    await waitFor(() => expect(a.result.current).toEqual({ visible: true, loading: false }));
    await waitFor(() => expect(b.result.current.visible).toBe(true));
    expect(svc.getAccess).toHaveBeenCalledTimes(1);

    resetOfferHunterAccessCache();
    svc.getAccess.mockRejectedValue({ code: 'SERVICE_UNAVAILABLE' });
    const c = renderHook(() => useOfferHunterAccess());
    await waitFor(() => expect(c.result.current).toEqual({ visible: false, loading: false }));
  });
});

describe('OfferHunterRoute', () => {
  const renderAt = () => render(
    <MemoryRouter initialEntries={['/offer-hunter']}>
      <Routes>
        <Route element={<OfferHunterRoute />}>
          <Route path="/offer-hunter" element={<p>tela do caçador</p>} />
        </Route>
        <Route path="/dashboard" element={<p>dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );

  it('visível abre a tela', async () => {
    svc.getAccess.mockResolvedValue({ visible: true });
    renderAt();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByText('tela do caçador')).toBeInTheDocument();
  });

  it('invisível volta ao dashboard', async () => {
    svc.getAccess.mockResolvedValue({ visible: false });
    renderAt();
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });
});

describe('useHuntFinds / useHuntRuns', () => {
  it('pagina só pelo cursor, sem duplicar, e aprova trocando o item local', async () => {
    svc.listFinds
      .mockResolvedValueOnce({ items: [find('a'), find('b')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [find('b'), find('c')], nextCursor: null });
    svc.approveFind.mockResolvedValue({ find: find('a', { status: 'APPROVED' }), offerId: 'o1' });
    const { result } = renderHook(() => useHuntFinds('h1'));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(svc.listFinds).toHaveBeenLastCalledWith('h1', null);
    expect(result.current.hasMore).toBe(true);

    await act(async () => { await result.current.loadMore(); });
    expect(svc.listFinds).toHaveBeenLastCalledWith('h1', 'c1');
    expect(result.current.items.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.hasMore).toBe(false);

    await act(async () => { await result.current.approve('a'); });
    expect(result.current.items[0].status).toBe('APPROVED');
  });

  it('cursor vencido (OFFER_HUNT_CURSOR_INVALID) recomeça do início', async () => {
    const run = { id: 'r1' } as HuntRun;
    svc.listRuns
      .mockResolvedValueOnce({ items: [run], nextCursor: 'velho' })
      .mockRejectedValueOnce({ code: 'OFFER_HUNT_CURSOR_INVALID' })
      .mockResolvedValueOnce({ items: [run], nextCursor: null });
    const { result } = renderHook(() => useHuntRuns('h1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => { await result.current.loadMore(); });
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(svc.listRuns).toHaveBeenLastCalledWith('h1', null);
    expect(result.current.errorCode).toBeNull();
  });

  it('sem huntId não carrega', () => {
    const { result } = renderHook(() => useHuntRuns(undefined));
    expect(result.current.loading).toBe(false);
    expect(svc.listRuns).not.toHaveBeenCalled();
  });
});

describe('useOfferHunts', () => {
  it('Switch de pausa troca a caçada na lista local', async () => {
    const hunt = { id: 'h1', status: 'ACTIVE' };
    svc.list.mockResolvedValue([hunt]);
    svc.pause.mockResolvedValue({ ...hunt, status: 'PAUSED', pauseReason: 'USER' });
    const { result } = renderHook(() => useOfferHunts());
    await waitFor(() => expect(result.current.hunts).toHaveLength(1));
    await act(async () => { await result.current.setActive('h1', false); });
    expect(svc.pause).toHaveBeenCalledWith('h1');
    expect(result.current.hunts?.[0].status).toBe('PAUSED');
    expect(result.current.busyId).toBeNull();
  });
});

describe('portões e aceite', () => {
  it('firstClosedGate segue a ordem da execução e ignora a IA', () => {
    const open = { plan: true, hunterEntitlement: true, credential: true, riskAccepted: true, aiAvailable: false, destination: true };
    expect(firstClosedGate(open)).toBeNull();
    expect(firstClosedGate({ ...open, riskAccepted: false, destination: false })).toBe('riskAccepted');
    expect(firstClosedGate({ ...open, plan: false, credential: false })).toBe('plan');
  });

  it('aceite envia scope OFFER_HUNTER com a versão do caçador; 409 vira stale', async () => {
    risk.acceptRisk.mockResolvedValueOnce({ acceptedAt: 'x', noticeVersion: '2026-11-12', scope: 'OFFER_HUNTER' });
    const { result } = renderHook(() => useHunterRiskAcceptance());
    await act(async () => { await result.current.accept(); });
    expect(risk.acceptRisk).toHaveBeenCalledWith('SHEIN', { noticeVersion: '2026-11-12', locale: 'pt-BR', scope: 'OFFER_HUNTER' });

    risk.acceptRisk.mockRejectedValueOnce({ code: 'MARKETPLACE_RISK_NOTICE_OUTDATED' });
    await act(async () => { await result.current.accept(); });
    expect(result.current.stale).toBe(true);
  });
});
