import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { opsMetricsService } from '@/services/opsMetrics.service';
import { OPS_REFRESH_MS, useOpsMetrics } from './useOpsMetrics';
import type { OpsLatest, OpsRange, OpsSeriesResult } from './types';

const LATEST: OpsLatest = {
  latest: [], thresholds: { memoryPct: 80, cpuPct: 80, idleInTransaction: 3, eventLoopP99Ms: 200 },
  topQueries: [], samplerActive: true, workers: [],
};
const SERIES: OpsSeriesResult = { window: { from: 'a', to: 'b' }, bucketMinutes: 15, series: [] };

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

afterEach(() => {
  vi.useRealTimers();
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

  it('desmontar com busca em voo não re-arma o timer nem aplica o resultado', async () => {
    vi.useFakeTimers();
    const latest = vi.spyOn(opsMetricsService, 'latest').mockResolvedValue(LATEST);
    vi.spyOn(opsMetricsService, 'series').mockResolvedValue(SERIES);
    const { result, unmount } = renderHook(() => useOpsMetrics('24h', true));
    await flush();
    const pending = deferred<OpsLatest>();
    latest.mockReturnValueOnce(pending.promise);
    await act(async () => { await vi.advanceTimersByTimeAsync(OPS_REFRESH_MS); });
    expect(latest).toHaveBeenCalledTimes(2);
    const before = result.current;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    unmount();
    await act(async () => { pending.resolve({ ...LATEST, samplerActive: false }); await vi.advanceTimersByTimeAsync(OPS_REFRESH_MS * 3); });
    expect(latest).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current).toBe(before);
    expect(err).not.toHaveBeenCalled();
  });

  it('troca de período no meio de um refresh: a resposta antiga nunca vence', async () => {
    vi.useFakeTimers();
    vi.spyOn(opsMetricsService, 'latest').mockResolvedValue(LATEST);
    const series = vi.spyOn(opsMetricsService, 'series').mockResolvedValue({ ...SERIES, bucketMinutes: 1 });
    const { result, rerender } = renderHook(({ r }) => useOpsMetrics(r, true), { initialProps: { r: '1h' as OpsRange } });
    await flush();
    const old = deferred<OpsSeriesResult>();
    series.mockReturnValueOnce(old.promise);
    await act(async () => { await vi.advanceTimersByTimeAsync(OPS_REFRESH_MS); });
    series.mockResolvedValue({ ...SERIES, bucketMinutes: 15 });
    rerender({ r: '24h' });
    await flush();
    expect(result.current.series.servers?.bucketMinutes).toBe(15);
    const callsAfterSwitch = series.mock.calls.length;
    await act(async () => { old.resolve({ ...SERIES, bucketMinutes: 1 }); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.series.servers?.bucketMinutes).toBe(15);
    expect(result.current.fetching).toBe(false);
    // O ciclo antigo não re-arma: na próxima volta só o período novo busca (3 séries).
    await act(async () => { await vi.advanceTimersByTimeAsync(OPS_REFRESH_MS); });
    expect(series.mock.calls.length).toBe(callsAfterSwitch + 3);
    const lastWindows = series.mock.calls.slice(-3).map((c) => Date.parse(c[1].to) - Date.parse(c[1].from));
    expect(lastWindows.every((ms) => ms === 24 * 60 * 60_000)).toBe(true);
  });

  it('desligar a atualização com refresh em voo encerra o ciclo', async () => {
    vi.useFakeTimers();
    const latest = vi.spyOn(opsMetricsService, 'latest').mockResolvedValue(LATEST);
    vi.spyOn(opsMetricsService, 'series').mockResolvedValue(SERIES);
    const { result, rerender } = renderHook(({ on }) => useOpsMetrics('24h', on), { initialProps: { on: true } });
    await flush();
    const pending = deferred<OpsLatest>();
    latest.mockReturnValueOnce(pending.promise);
    await act(async () => { await vi.advanceTimersByTimeAsync(OPS_REFRESH_MS); });
    rerender({ on: false });
    await act(async () => { pending.resolve({ ...LATEST, samplerActive: false }); await vi.advanceTimersByTimeAsync(OPS_REFRESH_MS * 3); });
    expect(latest).toHaveBeenCalledTimes(2);
    expect(result.current.latest?.samplerActive).toBe(true);
    expect(result.current.fetching).toBe(false);
  });
});
