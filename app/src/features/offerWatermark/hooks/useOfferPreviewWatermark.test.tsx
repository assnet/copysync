import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { OfferWatermark } from '../types';
import { useOfferPreviewWatermark } from './useOfferPreviewWatermark';

const access = vi.hoisted(() => ({ visible: true }));
const svc = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../offerWatermark.service', () => ({ offerWatermarkService: svc }));
vi.mock('./useOfferWatermarkAccess', () => ({ useOfferWatermarkAccess: () => ({ visible: access.visible, loading: false }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 't1' }) }));

const wm = (over: Partial<OfferWatermark> = {}): OfferWatermark => ({
  enabled: true, kind: 'IMAGE', text: null, position: 'BOTTOM_RIGHT', size: 'MEDIUM', opacity: 80,
  imageUrl: '/api/storage/logo.png', canEdit: true, updatedAt: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  access.visible = true;
});

describe('useOfferPreviewWatermark', () => {
  it('marca ligada com logo: devolve a marca', async () => {
    svc.get.mockResolvedValue(wm());
    const { result } = renderHook(() => useOfferPreviewWatermark());
    await waitFor(() => expect(result.current?.imageUrl).toBe('/api/storage/logo.png'));
    expect(svc.get).toHaveBeenCalledTimes(1);
  });

  it('desligada → null', async () => {
    svc.get.mockResolvedValue(wm({ enabled: false }));
    const { result } = renderHook(() => useOfferPreviewWatermark());
    await waitFor(() => expect(svc.get).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('IMAGE sem logo → null; TEXT vazio → null', async () => {
    svc.get.mockResolvedValue(wm({ imageUrl: null, text: 'Loja' }));
    const a = renderHook(() => useOfferPreviewWatermark());
    await waitFor(() => expect(svc.get).toHaveBeenCalledTimes(1));
    expect(a.result.current).toBeNull();
    svc.get.mockResolvedValue(wm({ kind: 'TEXT', text: '  ' }));
    const b = renderHook(() => useOfferPreviewWatermark());
    await waitFor(() => expect(svc.get).toHaveBeenCalledTimes(2));
    expect(b.result.current).toBeNull();
  });

  it('403 de plano → null', async () => {
    svc.get.mockRejectedValue({ status: 403, code: 'PLAN_FEATURE_UNAVAILABLE' });
    const { result } = renderHook(() => useOfferPreviewWatermark());
    await waitFor(() => expect(svc.get).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('fora da audiência: nem consulta', () => {
    access.visible = false;
    const { result } = renderHook(() => useOfferPreviewWatermark());
    expect(result.current).toBeNull();
    expect(svc.get).not.toHaveBeenCalled();
  });
});
