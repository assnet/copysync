import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { CapturedOfferItem } from '@/types/api.types';

const listCaptured = vi.fn();
vi.mock('@/services/monitoring.service', () => ({
  monitoringService: { listCaptured: (id: string, c?: string) => listCaptured(id, c), retryCaptured: vi.fn() },
}));

import { countCapturedByFilter, matchesCapturedFilter, useCapturedOffers } from './useCapturedOffers';

const item = (id: string, over: Partial<CapturedOfferItem> = {}): CapturedOfferItem => ({
  id, status: 'QUEUED', reason: null, marketplace: 'SHOPEE', sourceGroupTitle: 'G', sourceGroupAvatarUrl: null, textPreview: 'x',
  imageUrl: null, coupon: null, affiliateUrl: null, offerId: null, textSource: null, aiErrorCode: null, offerStatus: null,
  sentCount: 0, totalCount: 0, capturedAt: new Date().toISOString(), expiresAt: null, startsAt: null, imageUnavailable: false, ...over,
});

beforeEach(() => listCaptured.mockReset());

describe('filtros de capturadas', () => {
  it('separa recuperáveis, fila, em andamento e ignoradas', () => {
    const items = [
      item('a', { status: 'SKIPPED', reason: 'CREDENTIAL_MISSING' }),
      item('b', { status: 'SKIPPED', reason: 'NO_LINK' }),
      item('c'),
      item('d', { status: 'PROCESSING' }),
      item('e', { status: 'FAILED', reason: 'INTERNAL_ERROR' }),
    ];
    expect(countCapturedByFilter(items)).toEqual({ all: 5, action: 2, queued: 1, working: 1, skipped: 1 });
    expect(matchesCapturedFilter(items[1], 'action')).toBe(false);
  });

  it('FAILED sem motivo recuperável cai em "Ignoradas"; filtros somam o total', () => {
    const items = [
      item('a', { status: 'FAILED', reason: null }),
      item('b', { status: 'FAILED', reason: 'EXPIRED' }),
      item('c', { status: 'SKIPPED', reason: null }),
      item('d', { status: 'PENDING' }),
    ];
    const c = countCapturedByFilter(items);
    expect(c).toEqual({ all: 4, action: 0, queued: 0, working: 1, skipped: 3 });
    expect(c.action + c.queued + c.working + c.skipped).toBe(c.all);
  });
});

describe('useCapturedOffers', () => {
  it('preenche lastUpdatedAt após atualizar e zera as novas no refresh manual', async () => {
    listCaptured.mockResolvedValue({ items: [item('a')], nextCursor: null });
    const { result } = renderHook(() => useCapturedOffers('s1'));
    expect(result.current.lastUpdatedAt).toBeNull();
    await waitFor(() => expect(result.current.lastUpdatedAt).not.toBeNull());
    const first = result.current.lastUpdatedAt!;

    listCaptured.mockResolvedValue({ items: [item('b'), item('a')], nextCursor: null });
    await act(() => result.current.refresh());
    expect(result.current.items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(result.current.lastUpdatedAt).toBeGreaterThanOrEqual(first);
    expect(result.current.newSinceLastView).toBe(0);
  });

  it('polling que volta depois do "carregar mais" é descartado (lista não encolhe)', async () => {
    // Timers falsos desde o render (o polling nasce no mount); a 1ª carga é aguardada com act
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      listCaptured.mockResolvedValueOnce({ items: [item('a')], nextCursor: 'c1' });
      const { result } = renderHook(() => useCapturedOffers('s1'));
      await act(async () => { await Promise.resolve(); });
      expect(result.current.items).toHaveLength(1);

      let resolvePoll!: (v: unknown) => void;
      listCaptured.mockImplementationOnce(() => new Promise((r) => { resolvePoll = r; }));
      act(() => { vi.advanceTimersByTime(30_000); });
      expect(listCaptured).toHaveBeenCalledTimes(2);

      listCaptured.mockResolvedValueOnce({ items: [item('b')], nextCursor: null });
      await act(() => result.current.loadMore());
      expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b']);

      await act(async () => { resolvePoll({ items: [item('n'), item('a')], nextCursor: 'c1' }); });
      expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b']);
      expect(result.current.nextCursor).toBeNull();
    } finally {
      vis.mockRestore();
      vi.useRealTimers();
    }
  });
  it('"Atualizar" com polling em voo: descarta o polling e roda o manual depois', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    try {
      listCaptured.mockResolvedValueOnce({ items: [item('a')], nextCursor: null });
      const { result } = renderHook(() => useCapturedOffers('s1'));
      await act(async () => { await Promise.resolve(); });

      let resolvePoll!: (v: unknown) => void;
      listCaptured.mockImplementationOnce(() => new Promise((r) => { resolvePoll = r; }));
      act(() => { vi.advanceTimersByTime(30_000); });
      await act(() => result.current.refresh());
      expect(listCaptured).toHaveBeenCalledTimes(2);

      listCaptured.mockResolvedValueOnce({ items: [item('m'), item('n'), item('a')], nextCursor: null });
      await act(async () => { resolvePoll({ items: [item('n'), item('a')], nextCursor: null }); });
      await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['m', 'n', 'a']));
      expect(listCaptured).toHaveBeenCalledTimes(3);
      expect(result.current.newSinceLastView).toBe(0);
    } finally {
      vis.mockRestore();
      vi.useRealTimers();
    }
  });
});
