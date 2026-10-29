import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCopyToClipboard } from './useCopyToClipboard';

const stubClipboard = (writeText: () => Promise<void>) =>
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(writeText) }, configurable: true });

afterEach(() => vi.useRealTimers());

describe('useCopyToClipboard', () => {
  it('copia e marca copiado por 2 s', async () => {
    vi.useFakeTimers();
    stubClipboard(async () => undefined);
    const { result } = renderHook(() => useCopyToClipboard(vi.fn()));
    await act(() => result.current.copy('https://ana.ofertas.app'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://ana.ofertas.app');
    expect(result.current.copied).toBe(true);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.copied).toBe(false);
  });

  it('clipboard bloqueado chama onFailed', async () => {
    stubClipboard(async () => { throw new Error('denied'); });
    const onFailed = vi.fn();
    const { result } = renderHook(() => useCopyToClipboard(onFailed));
    await act(() => result.current.copy('x'));
    expect(onFailed).toHaveBeenCalled();
    expect(result.current.copied).toBe(false);
  });
});
