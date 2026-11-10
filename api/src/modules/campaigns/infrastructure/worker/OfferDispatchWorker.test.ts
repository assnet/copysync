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

describe('OfferDispatchWorker — etapas independentes', () => {
  type Run = (ctx: { signal: AbortSignal }) => Promise<{ processed: number }>;
  const stage = (name: string, run: Run) => ({ name, run: vi.fn(run) });
  const stuck = () => new Promise<{ processed: number }>(() => {});
  const ok = async () => ({ processed: 1 });

  it('legado: execute recebe o sinal e ele é abortado no stop', async () => {
    let seen: AbortSignal | undefined;
    const execute = vi.fn(async (ctx?: { signal: AbortSignal }) => {
      seen = ctx?.signal;
      return { processed: 0 };
    });
    const worker = new OfferDispatchWorker({ tick: () => ({ execute }) });
    await worker.runTick();
    expect(seen?.aborted).toBe(false);
    await worker.stop();
    expect(seen?.aborted).toBe(true);
  });

  it('etapa não sobrepõe a si mesma; a outra segue livre', async () => {
    const gate = deferred();
    const dispatch = stage('dispatch', async () => {
      await gate.promise;
      return { processed: 1 };
    });
    const capture = stage('capture', ok);
    const worker = new OfferDispatchWorker({ stages: [dispatch, capture] });
    void worker.runTick();
    await new Promise((r) => setTimeout(r, 0));
    void worker.runTick();
    await new Promise((r) => setTimeout(r, 0));
    expect(dispatch.run).toHaveBeenCalledTimes(1);
    expect(capture.run).toHaveBeenCalledTimes(2);
    gate.resolve();
    await worker.stop();
  });

  for (const [label, slowName] of [['envio preso', 'dispatch'], ['captura presa', 'capture']] as const) {
    it(`${label}: a outra etapa roda ≥3 rodadas em 10 s virtuais`, async () => {
      vi.useFakeTimers();
      try {
        const dispatch = stage('dispatch', slowName === 'dispatch' ? stuck : ok);
        const capture = stage('capture', slowName === 'capture' ? stuck : ok);
        const worker = new OfferDispatchWorker({ stages: [dispatch, capture], intervalMs: 2000, stopTimeoutMs: 50 });
        worker.start();
        await vi.advanceTimersByTimeAsync(10_000);
        const fast = slowName === 'dispatch' ? capture : dispatch;
        const slow = slowName === 'dispatch' ? dispatch : capture;
        expect(fast.run.mock.calls.length).toBeGreaterThanOrEqual(3);
        expect(slow.run).toHaveBeenCalledTimes(1);
        const stopping = worker.stop();
        await vi.advanceTimersByTimeAsync(60);
        await stopping;
      } finally {
        vi.useRealTimers();
      }
    });
  }

  it('falha síncrona e assíncrona de uma etapa não afeta a outra nem a próxima rodada', async () => {
    const sync = stage('dispatch', () => {
      throw new Error('sync');
    });
    const asyncFail = stage('capture', async () => {
      throw new Error('async');
    });
    const worker = new OfferDispatchWorker({ stages: [sync, asyncFail] });
    await expect(worker.runTick()).resolves.toBeUndefined();
    await expect(worker.runTick()).resolves.toBeUndefined();
    expect(sync.run).toHaveBeenCalledTimes(2);
    expect(asyncFail.run).toHaveBeenCalledTimes(2);
  });

  it('cada combinação de etapas habilitadas só executa as presentes', async () => {
    for (const names of [[], ['dispatch'], ['capture'], ['dispatch', 'capture']]) {
      const stages = names.map((n) => stage(n, ok));
      const worker = new OfferDispatchWorker({ stages });
      await worker.runTick();
      for (const s of stages) expect(s.run).toHaveBeenCalledTimes(1);
      await worker.stop();
    }
  });

  it('stop sinaliza as duas etapas antes de aguardar qualquer uma, sob teto único', async () => {
    const signals: AbortSignal[] = [];
    const hold = (ctx: { signal: AbortSignal }) => {
      signals.push(ctx.signal);
      return stuck();
    };
    const worker = new OfferDispatchWorker({ stages: [stage('dispatch', hold), stage('capture', hold)], stopTimeoutMs: 30 });
    void worker.runTick();
    expect(signals.every((s) => !s.aborted)).toBe(true);
    const t0 = Date.now();
    const stopping = worker.stop();
    expect(signals.map((s) => s.aborted)).toEqual([true, true]);
    await stopping;
    // Um teto só (não 30 ms por etapa)
    expect(Date.now() - t0).toBeLessThan(55);
  });

  it('stop respeita orçamento menor que o teto e não inicia ticks depois', async () => {
    const dispatch = stage('dispatch', stuck);
    const capture = stage('capture', ok);
    const worker = new OfferDispatchWorker({ stages: [dispatch, capture], stopTimeoutMs: 10_000 });
    void worker.runTick();
    const t0 = Date.now();
    await worker.stop({ timeoutMs: 20 });
    expect(Date.now() - t0).toBeLessThan(1000);
    await worker.runTick();
    expect(dispatch.run).toHaveBeenCalledTimes(1);
    expect(capture.run).toHaveBeenCalledTimes(1);
  });

  it('stop espera a etapa terminar quando ela termina dentro do teto', async () => {
    const gate = deferred();
    const dispatch = stage('dispatch', async () => {
      await gate.promise;
      return { processed: 1 };
    });
    const worker = new OfferDispatchWorker({ stages: [dispatch] });
    void worker.runTick();
    let stopped = false;
    const stopping = worker.stop().then(() => (stopped = true));
    await Promise.resolve();
    expect(stopped).toBe(false);
    gate.resolve();
    await stopping;
    expect(stopped).toBe(true);
  });

  it('resumo no máximo uma vez por intervalo, sem IDs', async () => {
    const { logger } = await import('../../../../shared/logger/logger');
    const info = vi.fn();
    const child = vi.spyOn(logger, 'child').mockReturnValue({ info, debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never);
    try {
      let t = 0;
      const worker = new OfferDispatchWorker({ stages: [stage('dispatch', ok), stage('capture', ok)], clock: () => t, summaryIntervalMs: 60_000 });
      for (t = 0; t <= 130_000; t += 2_000) await worker.runTick();
      const summaries = info.mock.calls.filter((c) => c[1] === 'offer worker summary');
      expect(summaries).toHaveLength(2);
      expect(summaries[0]![0]).toMatchObject({ stages: { dispatch: { runs: 30, processed: 30, failures: 0 }, capture: { runs: 30 } } });
      expect(summaries[0]![0]).toHaveProperty('cpuMs');
      expect(summaries[0]![0]).toHaveProperty('rssBytes');
      await worker.stop();
    } finally {
      child.mockRestore();
    }
  });
});
