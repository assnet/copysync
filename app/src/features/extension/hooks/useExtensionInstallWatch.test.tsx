import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { INSTALL_WATCH_KEY, useExtensionInstallWatch } from './useExtensionInstallWatch';

vi.mock('../channel/client', () => ({ detectExtension: vi.fn(async () => false) }));

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('useExtensionInstallWatch', () => {
  it('fica parado até start; detecta → onDetected uma vez e limpa a espera salva', async () => {
    const detect = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const onDetected = vi.fn();
    const { result } = renderHook(() => useExtensionInstallWatch({ onDetected, detect, intervalMs: 3000 }));
    expect(result.current.phase).toBe('idle');
    expect(detect).not.toHaveBeenCalled();

    act(() => result.current.start());
    await tick(0);
    expect(result.current.phase).toBe('waiting');
    expect(sessionStorage.getItem(`ui.${INSTALL_WATCH_KEY}`)).not.toBeNull();

    await tick(3000);
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('detected');
    expect(sessionStorage.getItem(`ui.${INSTALL_WATCH_KEY}`)).toBeNull();

    await tick(9000);
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('para no teto e recomeça com start', async () => {
    const detect = vi.fn().mockResolvedValue(false);
    const onDetected = vi.fn();
    const { result } = renderHook(() =>
      useExtensionInstallWatch({ onDetected, detect, intervalMs: 1000, timeoutMs: 5000 }));
    act(() => result.current.start());
    await tick(6000);
    expect(result.current.phase).toBe('timed_out');
    const calls = detect.mock.calls.length;
    await tick(5000);
    expect(detect.mock.calls.length).toBe(calls);

    act(() => result.current.start());
    await tick(0);
    expect(result.current.phase).toBe('waiting');
    expect(detect.mock.calls.length).toBeGreaterThan(calls);
    expect(onDetected).not.toHaveBeenCalled();
  });

  it('checa ao voltar para a aba e retoma a espera salva após reload', async () => {
    sessionStorage.setItem(`ui.${INSTALL_WATCH_KEY}`, JSON.stringify({ v: 0, d: Date.now() }));
    const detect = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useExtensionInstallWatch({ onDetected: vi.fn(), detect, intervalMs: 60_000 }));
    await tick(0);
    expect(result.current.phase).toBe('waiting');
    expect(detect).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('erro na checagem conta como não detectada', async () => {
    const detect = vi.fn().mockRejectedValue(new Error('x'));
    const onDetected = vi.fn();
    const { result } = renderHook(() => useExtensionInstallWatch({ onDetected, detect }));
    act(() => result.current.start());
    await tick(3000);
    expect(result.current.phase).toBe('waiting');
    expect(onDetected).not.toHaveBeenCalled();
  });
});
