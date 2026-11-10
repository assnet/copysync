import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { opsMetricsService } from '@/services/opsMetrics.service';
import { OPS_REFRESH_MS, useOpsMetrics } from './useOpsMetrics';
import type { OpsLatest, OpsSeriesResult } from './types';

const LATEST: OpsLatest = {
  latest: [], thresholds: { memoryPct: 80, cpuPct: 80, idleInTransaction: 3, eventLoopP99Ms: 200 },
  topQueries: [], samplerActive: true, workers: [],
};
const SERIES: OpsSeriesResult = { window: { from: 'a', to: 'b' }, bucketMinutes: 15, series: [] };

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  vi.restoreAllMocks();
  setVisibility('visible');
});

describe('useOpsMetrics', () => {
  it('atualiza a cada 60 s, pausa com a aba oculta e retoma ao voltar', async () => {
    vi.useFakeTimers();
    const latest = vi.spyOn(opsMetricsService, 'latest').mockResolvedValue(LATEST);
    vi.spyOn(opsMetricsService, 'series').mockResolvedValue(SERIES);

    const { result } = renderHook(() => useOpsMetrics('24h', true));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(latest).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(OPS_REFRESH_MS); });
    expect(latest).toHaveBeenCalledTimes(2);

    setVisibility('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(OPS_REFRESH_MS * 3); });
    expect(latest).toHaveBeenCalledTimes(2);

    await act(async () => { setVisibility('visible'); await vi.advanceTimersByTimeAsync(0); });
    expect(latest).toHaveBeenCalledTimes(3);
  });

  it('sem atualização automática só busca uma vez', async () => {
    vi.useFakeTimers();
    const latest = vi.spyOn(opsMetricsService, 'latest').mockResolvedValue(LATEST);
    vi.spyOn(opsMetricsService, 'series').mockResolvedValue(SERIES);
    renderHook(() => useOpsMetrics('1h', false));
    await act(async () => { await vi.advanceTimersByTimeAsync(OPS_REFRESH_MS * 2); });
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('erro por bloco não derruba os outros; refresh que falha inteiro mantém os dados', async () => {
    vi.spyOn(opsMetricsService, 'latest').mockResolvedValue(LATEST);
    const series = vi.spyOn(opsMetricsService, 'series')
      .mockResolvedValueOnce(SERIES)
      .mockRejectedValueOnce(new Error('db'))
      .mockResolvedValueOnce(SERIES);
    const { result } = renderHook(() => useOpsMetrics('24h', false));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errors).toEqual({ latest: false, servers: false, database: true, workers: false });
    expect(result.current.latest).toEqual(LATEST);

    vi.spyOn(opsMetricsService, 'latest').mockRejectedValue(new Error('x'));
    series.mockRejectedValue(new Error('x'));
    await act(async () => { await result.current.reload(); });
    expect(result.current.refreshError).toBe(true);
    expect(result.current.latest).toEqual(LATEST);
  });
});
