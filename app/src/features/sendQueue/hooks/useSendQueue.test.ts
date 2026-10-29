import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { SendQueueResponse } from '@/types/api.types';

const get = vi.fn<(sessionId?: string) => Promise<SendQueueResponse>>();
vi.mock('@/services/sendQueue.service', () => ({ sendQueueService: { get: (id?: string) => get(id) } }));

import { useSendQueue } from './useSendQueue';

const resp = (name: string): SendQueueResponse => ({ serverTime: '2026-10-28T12:00:00.000Z', sendingPausedAt: null, sessions: [{
  sessionId: name, name, status: 'CONNECTED', running: null, waiting: [], recent: [],
  counts: { waiting: 0, paused: 0, sentToday: 0, failedToday: 0, skippedToday: 0 },
}] });

beforeEach(() => { get.mockReset(); });

describe('useSendQueue', () => {
  it('troca de sessão com requisição em voo: resposta antiga é descartada', async () => {
    let releaseOld!: (v: SendQueueResponse) => void;
    get.mockImplementationOnce(() => new Promise((r) => { releaseOld = r; }));
    get.mockImplementationOnce(async () => resp('s2'));
    const { result, rerender } = renderHook(({ id }) => useSendQueue(id), { initialProps: { id: 's1' } });
    rerender({ id: 's2' });
    await waitFor(() => expect(result.current.data?.sessions[0]?.sessionId).toBe('s2'));
    await act(async () => { releaseOld(resp('s1')); });
    expect(result.current.data?.sessions[0]?.sessionId).toBe('s2');
    expect(get).toHaveBeenNthCalledWith(2, 's2');
  });
});

describe('useSendQueue — refresh explícito', () => {
  it('com poll em voo, refresh espera e busca de novo (não vira no-op)', async () => {
    let release!: (v: SendQueueResponse) => void;
    get.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    get.mockImplementationOnce(async () => resp('s1b'));
    const { result } = renderHook(() => useSendQueue('s1'));
    const refreshing = result.current.refresh();
    release(resp('s1a'));
    await refreshing;
    expect(get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.data?.sessions[0]?.sessionId).toBe('s1b'));
  });
});
