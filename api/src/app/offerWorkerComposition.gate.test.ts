import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfferDispatchWorker } from '../modules/campaigns/infrastructure/worker/OfferDispatchWorker';
import { jobsFor } from './processJobs';
import { buildOfferWorkerOptions, offerWorkerStopOptions } from './offerWorkerComposition';

/**
 * Gate reproduzível da entrega A (T5, MQ-01/04): composição real + worker real, dublês nos use
 * cases e relógio virtual. Sem WhatsApp, banco, rede ou cliente real.
 */
const STUCK_MS = 60_000;
const FAST_MS = 100;
const WINDOW_MS = 10_000;

function timed(ms: number) {
  return {
    execute: vi.fn((ctx?: { signal?: AbortSignal }) => {
      void ctx;
      return new Promise<{ processed: number }>((r) => setTimeout(() => r({ processed: 1 }), ms));
    }),
  };
}

function worker(independentStages: boolean, dispatchMs: number, monitoringMs: number) {
  const dispatch = timed(dispatchMs);
  const monitoring = timed(monitoringMs);
  const options = buildOfferWorkerOptions({
    jobs: jobsFor('worker'),
    flags: { offerDispatch: true, groupMonitoring: true, independentStages },
    runners: { offerDispatch: () => dispatch, groupMonitoring: () => monitoring },
    onLegacyPartError: vi.fn(),
  });
  if (!options) throw new Error('worker esperado');
  return { w: new OfferDispatchWorker({ ...options, intervalMs: 2_000 }), dispatch, monitoring };
}

async function stopNow(w: OfferDispatchWorker) {
  const p = w.stop({ timeoutMs: 0 });
  await vi.advanceTimersByTimeAsync(0);
  await p;
}

describe('gate A — etapas independentes (relógio virtual)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('envio preso 60 s: ≥3 rodadas de captura em 10 s; envio não se sobrepõe', async () => {
    const { w, dispatch, monitoring } = worker(true, STUCK_MS, FAST_MS);
    w.start();
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(monitoring.execute.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(dispatch.execute).toHaveBeenCalledTimes(1);
    await stopNow(w);
  });

  it('inverso: captura presa 60 s: ≥3 rodadas de envio em 10 s', async () => {
    const { w, dispatch, monitoring } = worker(true, FAST_MS, STUCK_MS);
    w.start();
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(dispatch.execute.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(monitoring.execute).toHaveBeenCalledTimes(1);
    await stopNow(w);
  });

  it('baseline legado (flag false): envio preso segura a captura — 0 rodadas em 10 s', async () => {
    const { w, dispatch, monitoring } = worker(false, STUCK_MS, FAST_MS);
    w.start();
    await vi.advanceTimersByTimeAsync(WINDOW_MS);
    expect(dispatch.execute).toHaveBeenCalledTimes(1);
    expect(monitoring.execute).not.toHaveBeenCalled();
    await stopNow(w);
  });

  it('parada com as duas etapas presas respeita o teto do orçamento e sinaliza ambas', async () => {
    const signals: AbortSignal[] = [];
    const hang = { execute: vi.fn((ctx?: { signal?: AbortSignal }) => {
      if (ctx?.signal) signals.push(ctx.signal);
      return new Promise<{ processed: number }>(() => {});
    }) };
    const options = buildOfferWorkerOptions({
      jobs: jobsFor('all'),
      flags: { offerDispatch: true, groupMonitoring: true, independentStages: true },
      runners: { offerDispatch: () => hang, groupMonitoring: () => hang },
      onLegacyPartError: vi.fn(),
    });
    const w = new OfferDispatchWorker(options!);
    w.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(hang.execute).toHaveBeenCalledTimes(2);

    // keeper/adoção já consumiram 15 s: sobram 27 − 15 − 10 = 2 s
    const stopOpts = offerWorkerStopOptions(true, 15_000);
    expect(stopOpts.timeoutMs).toBe(2_000);
    let done = false;
    const stopping = w.stop(stopOpts).then(() => (done = true));
    expect(signals).toHaveLength(2);
    expect(signals.every((s) => s.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(done).toBe(true);
    // sem ticks novos depois da parada
    await vi.advanceTimersByTimeAsync(10_000);
    expect(hang.execute).toHaveBeenCalledTimes(2);
  });

  it('teto nunca passa do stopTimeoutMs do worker (10 s) mesmo com orçamento maior', async () => {
    const hang = { execute: vi.fn(() => new Promise<{ processed: number }>(() => {})) };
    const options = buildOfferWorkerOptions({
      jobs: jobsFor('worker'),
      flags: { offerDispatch: true, groupMonitoring: false, independentStages: true },
      runners: { offerDispatch: () => hang, groupMonitoring: () => hang },
      onLegacyPartError: vi.fn(),
    });
    const w = new OfferDispatchWorker(options!);
    void w.runTick();
    let done = false;
    const stopping = w.stop(offerWorkerStopOptions(true, 0)).then(() => (done = true)); // 17 s de orçamento
    await vi.advanceTimersByTimeAsync(9_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(done).toBe(true);
  });
});
