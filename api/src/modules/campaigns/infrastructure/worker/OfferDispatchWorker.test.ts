import { describe, it, expect, vi } from 'vitest';
import { OfferDispatchWorker } from './OfferDispatchWorker';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('OfferDispatchWorker', () => {
  it('pula tick sobreposto e stop espera o tick em curso', async () => {
    const gate = deferred();
    const execute = vi.fn(async () => {
      await gate.promise;
      return { processed: 1 };
    });
    const worker = new OfferDispatchWorker({ tick: () => ({ execute }) });

    const first = worker.runTick();
    void worker.runTick();
    expect(execute).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = worker.stop().then(() => (stopped = true));
    await Promise.resolve();
    expect(stopped).toBe(false);

    gate.resolve();
    await first;
    await stopping;
    expect(stopped).toBe(true);
  });

  it('erro (até síncrono) não derruba e libera o próximo tick', async () => {
    const execute = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockResolvedValueOnce({ processed: 0 });
    const worker = new OfferDispatchWorker({ tick: () => ({ execute }) });

    await expect(worker.runTick()).resolves.toBeUndefined();
    await worker.runTick();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('start agenda com intervalo e stop limpa', async () => {
    vi.useFakeTimers();
    const execute = vi.fn().mockResolvedValue({ processed: 0 });
    const worker = new OfferDispatchWorker({ tick: () => ({ execute }), intervalMs: 2000 });
    worker.start();
    await vi.advanceTimersByTimeAsync(4100);
    expect(execute).toHaveBeenCalledTimes(2);
    await worker.stop();
    await vi.advanceTimersByTimeAsync(4000);
    expect(execute).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('stop não espera além do timeout por tick preso', async () => {
    const execute = vi.fn(() => new Promise<{ processed: number }>(() => {}));
    const worker = new OfferDispatchWorker({ tick: () => ({ execute }), stopTimeoutMs: 20 });
    void worker.runTick();
    await expect(worker.stop()).resolves.toBeUndefined();
  });
});
