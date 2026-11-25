import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetOfferWatermarkAccessCache, useOfferWatermarkAccess } from './useOfferWatermarkAccess';
import { OfferWatermarkRoute } from '../components/OfferWatermarkRoute';

const svc = vi.hoisted(() => ({ getAccess: vi.fn() }));
vi.mock('../offerWatermark.service', () => ({ offerWatermarkService: svc }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 't1' }) }));

beforeEach(() => {
  vi.clearAllMocks();
  resetOfferWatermarkAccessCache();
});

describe('useOfferWatermarkAccess', () => {
  it('menu e guard dividem uma consulta; erro fecha (invisível)', async () => {
    svc.getAccess.mockResolvedValue({ visible: true });
    const a = renderHook(() => useOfferWatermarkAccess());
    const b = renderHook(() => useOfferWatermarkAccess());
    expect(a.result.current).toEqual({ visible: false, loading: true });
    await waitFor(() => expect(a.result.current).toEqual({ visible: true, loading: false }));
    await waitFor(() => expect(b.result.current.visible).toBe(true));
    expect(svc.getAccess).toHaveBeenCalledTimes(1);

    resetOfferWatermarkAccessCache();
    svc.getAccess.mockRejectedValue({ code: 'SERVICE_UNAVAILABLE' });
    const c = renderHook(() => useOfferWatermarkAccess());
    await waitFor(() => expect(c.result.current).toEqual({ visible: false, loading: false }));
  });
});

describe('OfferWatermarkRoute', () => {
  const renderAt = () => render(
    <MemoryRouter initialEntries={['/offer-watermark']}>
      <Routes>
        <Route element={<OfferWatermarkRoute />}>
          <Route path="/offer-watermark" element={<p>tela da marca</p>} />
        </Route>
        <Route path="/dashboard" element={<p>dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );

  it('visível abre a tela', async () => {
    svc.getAccess.mockResolvedValue({ visible: true });
    renderAt();
    expect(await screen.findByText('tela da marca')).toBeInTheDocument();
  });

  it('invisível vai ao dashboard', async () => {
    svc.getAccess.mockResolvedValue({ visible: false });
    renderAt();
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });
});
