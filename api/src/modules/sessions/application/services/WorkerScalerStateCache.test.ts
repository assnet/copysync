import { describe, it, expect, vi } from 'vitest';
import { WorkerScalerStateCache, WORKER_SCALER_STATE_TTL_MS } from './WorkerScalerStateCache';

const ready = { status: 'ready', desiredReplicas: 1, runningReplicas: 1, hasDisk: false, autoscalingEnabled: false } as const;

describe('WorkerScalerStateCache', () => {
  it('serve do cache dentro do TTL, relê depois e após invalidate', async () => {
    let t = 0;
    const getState = vi.fn(async () => ready);
    const cache = new WorkerScalerStateCache({ getState }, { now: () => t });
    await cache.get();
    t = WORKER_SCALER_STATE_TTL_MS - 1;
    await cache.get();
    expect(getState).toHaveBeenCalledTimes(1);
    t = WORKER_SCALER_STATE_TTL_MS;
    await cache.get();
    expect(getState).toHaveBeenCalledTimes(2);
    cache.invalidate();
    await cache.get();
    expect(getState).toHaveBeenCalledTimes(3);
  });

  it('leituras simultâneas compartilham a chamada; falha não fica guardada', async () => {
    const getState = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(ready);
    const cache = new WorkerScalerStateCache({ getState }, { now: () => 0 });
    const [a, b] = [cache.get(), cache.get()];
    await expect(a).rejects.toThrow('x');
    await expect(b).rejects.toThrow('x');
    expect(getState).toHaveBeenCalledTimes(1);
    await expect(cache.get()).resolves.toEqual(ready);
    expect(getState).toHaveBeenCalledTimes(2);
  });
});
