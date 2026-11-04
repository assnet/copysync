import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionLeaseKeeper } from './SessionLeaseKeeper';
import { LEASE_RENEW_INTERVAL_MS } from '../../domain/services/sessionLeasePolicy';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('SessionLeaseKeeper', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('roda a cada 20 s depois do start', async () => {
    const execute = vi.fn(async () => undefined);
    const keeper = new SessionLeaseKeeper({ execute }, undefined, { warn: vi.fn() });
    keeper.start();
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS - 1);
    expect(execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_INTERVAL_MS);
    expect(execute).toHaveBeenCalledTimes(2);
    await keeper.stop();
  });

  it('não sobrepõe ticks: o próximo só agenda depois que o atual termina', async () => {
    const d = deferred();
    const execute = vi.fn(() => d.promise);
    const keeper = new SessionLeaseKeeper({ execute }, 1_000, { warn: vi.fn() });
    keeper.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(execute).toHaveBeenCalledTimes(1);
    d.resolve();
    await vi.advanceTimersByTimeAsync(999);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledTimes(2);
    await keeper.stop();
  });

  it('stop impede novo tick', async () => {
    const execute = vi.fn(async () => undefined);
    const keeper = new SessionLeaseKeeper({ execute }, 1_000, { warn: vi.fn() });
    keeper.start();
    await keeper.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(execute).not.toHaveBeenCalled();
  });

  it('stop espera o tick em curso e não agenda outro', async () => {
    const d = deferred();
    const execute = vi.fn(() => d.promise);
    const keeper = new SessionLeaseKeeper({ execute }, 1_000, { warn: vi.fn() });
    keeper.start();
    await vi.advanceTimersByTimeAsync(1_000);
    let stopped = false;
    const stopping = keeper.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    d.resolve();
    await stopping;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('erro no tick é logado e o keeper segue', async () => {
    const log = { warn: vi.fn() };
    const execute = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    const keeper = new SessionLeaseKeeper({ execute }, 1_000, log);
    keeper.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(2);
    await keeper.stop();
  });

  it('start duplo não cria dois agendamentos', async () => {
    const execute = vi.fn(async () => undefined);
    const keeper = new SessionLeaseKeeper({ execute }, 1_000, { warn: vi.fn() });
    keeper.start();
    keeper.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(execute).toHaveBeenCalledTimes(1);
    await keeper.stop();
  });
});
