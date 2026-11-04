import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionAdoptionTicker } from './SessionAdoptionTicker';
import { ADOPT_TICK_MS } from '../../domain/services/sessionAdoptionPolicy';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('SessionAdoptionTicker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('roda a cada ADOPT_TICK_MS e não sobrepõe ticks', async () => {
    const d = deferred();
    const execute = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue('none');
    const t = new SessionAdoptionTicker({ execute }, undefined, { warn: vi.fn() });
    t.start();
    await vi.advanceTimersByTimeAsync(ADOPT_TICK_MS - 1);
    expect(execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(ADOPT_TICK_MS * 3);
    expect(execute).toHaveBeenCalledTimes(1);
    d.resolve();
    await vi.advanceTimersByTimeAsync(ADOPT_TICK_MS);
    expect(execute).toHaveBeenCalledTimes(2);
    await t.stop();
  });

  it('erro do tick só loga e segue agendando', async () => {
    const warn = vi.fn();
    const execute = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('none');
    const t = new SessionAdoptionTicker({ execute }, 1_000, { warn });
    t.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
    await t.stop();
  });

  it('stop durante tick espera o tick e não agenda outro', async () => {
    const d = deferred();
    const execute = vi.fn(() => d.promise);
    const t = new SessionAdoptionTicker({ execute }, 1_000, { warn: vi.fn() });
    t.start();
    await vi.advanceTimersByTimeAsync(1_000);
    let stopped = false;
    const stopping = t.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    d.resolve();
    await stopping;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('stop antes do 1º tick impede execução; timer é unref', async () => {
    const execute = vi.fn(async () => 'none');
    const t = new SessionAdoptionTicker({ execute }, 1_000, { warn: vi.fn() });
    const spy = vi.spyOn(globalThis, 'setTimeout');
    t.start();
    const timer = spy.mock.results[0]?.value as { hasRef?: () => boolean };
    expect(timer.hasRef?.() ?? false).toBe(false);
    await t.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(execute).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
