import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { OfferItem } from '@/types/api.types';

const svc = vi.hoisted(() => ({
  usage: vi.fn(), generate: vi.fn(), update: vi.fn(), get: vi.fn(),
}));
vi.mock('@/services/offer.service', () => ({ offerService: svc }));
vi.mock('@/services/media.service', () => ({ mediaService: {} }));

import { useOfferGenerator } from './useOfferGenerator';

const base: OfferItem = {
  id: 'o1', provider: 'AMAZON', sourceUrl: 'https://a', productRef: null, title: 'Fone', priceCents: null,
  originalPriceCents: null, imageUrl: null, affiliateUrl: 'https://a', attributionVerified: true, coupon: null,
  audience: 'STANDARD', mentionAll: false, imageMode: 'MEDIA', simulateTyping: false, typingSeconds: 15, scheduledAt: null,
  origin: 'GENERATOR', expiresAt: null, text: 'oferta', textEdited: false, status: 'DRAFT',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function opened() {
  const hook = renderHook(() => useOfferGenerator());
  await act(async () => { await hook.result.current.generate({ url: 'https://a', audience: 'STANDARD' }); });
  return hook;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  svc.usage.mockResolvedValue({ used: 0, limit: 10 });
  svc.generate.mockResolvedValue({ offer: base, needsManualData: false, aiFallback: false });
});

describe('setImageMode', () => {
  it('falha volta só o formato, sem desfazer outro PATCH concluído no meio', async () => {
    const { result } = await opened();
    const slow = deferred<OfferItem>();
    svc.update.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ ...base, mentionAll: true });

    let modeCall!: Promise<void>;
    act(() => { modeCall = result.current.setImageMode('LINK_PREVIEW').catch(() => undefined); });
    expect(result.current.offer?.imageMode).toBe('LINK_PREVIEW');
    await act(async () => { await result.current.setMentionAll(true); });
    expect(result.current.offer?.mentionAll).toBe(true);

    await act(async () => { slow.reject(new Error('recusado')); await modeCall; });
    expect(result.current.offer?.imageMode).toBe('MEDIA');
    expect(result.current.offer?.mentionAll).toBe(true);
    expect(result.current.imageModeSaving).toBe(false);
  });

  it('resposta antiga não sobrescreve a troca mais recente', async () => {
    const { result } = await opened();
    const first = deferred<OfferItem>();
    svc.update.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ...base, imageMode: 'MEDIA' });

    let firstCall!: Promise<void>;
    act(() => { firstCall = result.current.setImageMode('LINK_PREVIEW'); });
    await act(async () => { await result.current.setImageMode('MEDIA'); });
    await act(async () => { first.resolve({ ...base, imageMode: 'LINK_PREVIEW' }); await firstCall; });
    expect(result.current.offer?.imageMode).toBe('MEDIA');
  });
});
