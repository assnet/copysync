import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IWorkerHeartbeatRepository } from '../../domain/contracts/IWorkerHeartbeatRepository';
import { defaultWorkerScalingSettings, type WorkerScalingSettings } from '../../domain/services/workerScalingSettings';
import { WorkerHeartbeatJob, cpuPercent, type EventLoopDelaySampler } from './WorkerHeartbeatJob';

function fakeLoop(p99Ns: number) {
  const h = { enable: vi.fn(), disable: vi.fn(), reset: vi.fn(), percentile: vi.fn(() => p99Ns) };
  return h satisfies EventLoopDelaySampler;
}

function setup(extra: { cpu?: () => NodeJS.CpuUsage; clock?: () => number; loop?: EventLoopDelaySampler } = {}) {
  const heartbeats = {
    beat: vi.fn(async () => undefined),
    listAlive: vi.fn(async () => []),
    hasAlive: vi.fn(async () => false),
    remove: vi.fn(async () => undefined),
  } satisfies IWorkerHeartbeatRepository;
  let local = ['s1', 's2'];
  let pending = 3;
  let settings: WorkerScalingSettings = defaultWorkerScalingSettings({ maxSessionsPerWorker: 40, maxPendingLoginsPerWorker: 10 });
  const job = new WorkerHeartbeatJob({
    heartbeats, workerId: 'w1', role: 'worker', settings: () => settings,
    occupancy: () => ({ sessions: local.length, pendingLogins: pending }), rssMb: () => 321,
    cpuUsage: extra.cpu ?? (() => ({ user: 0, system: 0 })), monotonicMs: extra.clock ?? (() => 0),
    eventLoopDelay: () => extra.loop ?? fakeLoop(0),
  });
  return {
    job, heartbeats,
    setLocal: (ids: string[]) => { local = ids; },
    setPending: (n: number) => { pending = n; },
    setMax: (n: number) => { settings = { ...settings, maxSessionsPerWorker: n }; },
  };
}

afterEach(() => vi.useRealTimers());

describe('WorkerHeartbeatJob', () => {
  it('bate no start e a cada 20 s com sessões locais, teto e RSS', async () => {
    vi.useFakeTimers();
    const { job, heartbeats, setLocal, setPending } = setup();
    job.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeats.beat).toHaveBeenLastCalledWith({
      workerId: 'w1', role: 'worker', sessions: 2, pendingLogins: 3, maxSessions: 40, rssMb: 321, cpuPct: null, eventLoopP99Ms: null,
    });
    setLocal(['s1']);
    setPending(0);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(heartbeats.beat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(heartbeats.beat).toHaveBeenCalledTimes(2);
    expect(heartbeats.beat).toHaveBeenLastCalledWith(expect.objectContaining({ sessions: 1, pendingLogins: 0 }));
    await job.stop();
  });

  it('stop para o ticker e remove o heartbeat do worker', async () => {
    vi.useFakeTimers();
    const { job, heartbeats } = setup();
    job.start();
    await vi.advanceTimersByTimeAsync(0);
    await job.stop();
    expect(heartbeats.remove).toHaveBeenCalledWith('w1');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heartbeats.beat).toHaveBeenCalledTimes(1);
  });

  it('falha de banco no beat e no remove não lança', async () => {
    const { job, heartbeats } = setup();
    heartbeats.beat.mockRejectedValueOnce(new Error('db'));
    heartbeats.remove.mockRejectedValueOnce(new Error('db'));
    await expect(job.runTick()).resolves.toBeUndefined();
    await expect(job.stop()).resolves.toBeUndefined();
  });

  it('cpuPct = delta de user+system sobre o tempo de parede entre batimentos', async () => {
    let cpu = { user: 1_000_000, system: 500_000 };
    let clock = 10_000;
    const { job, heartbeats } = setup({ cpu: () => cpu, clock: () => clock });
    await job.runTick();
    expect(heartbeats.beat).toHaveBeenLastCalledWith(expect.objectContaining({ cpuPct: null }));
    // 20 s de parede, 5 s de CPU (3 user + 2 system) → 25%
    cpu = { user: 4_000_000, system: 2_500_000 };
    clock = 30_000;
    await job.runTick();
    expect(heartbeats.beat).toHaveBeenLastCalledWith(expect.objectContaining({ cpuPct: 25 }));
    // próximo delta parte da última leitura, não da primeira
    cpu = { user: 4_200_000, system: 2_500_000 };
    clock = 50_000;
    await job.runTick();
    expect(heartbeats.beat).toHaveBeenLastCalledWith(expect.objectContaining({ cpuPct: 1 }));
  });

  it('cpuPercent: intervalo inválido ou contador regredido → null', () => {
    expect(cpuPercent({ user: 0, system: 0 }, { user: 1, system: 0 }, 0)).toBeNull();
    expect(cpuPercent({ user: 10, system: 0 }, { user: 5, system: 0 }, 1000)).toBeNull();
  });

  it('p99 do event loop em ms e histograma zerado após cada leitura; desliga no stop', async () => {
    vi.useFakeTimers();
    const loop = fakeLoop(250 * 1e6);
    const { job, heartbeats } = setup({ loop });
    job.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(loop.enable).toHaveBeenCalledTimes(1);
    expect(loop.percentile).toHaveBeenCalledWith(99);
    expect(loop.reset).toHaveBeenCalledTimes(1);
    expect(heartbeats.beat).toHaveBeenLastCalledWith(expect.objectContaining({ eventLoopP99Ms: 250 }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(loop.reset).toHaveBeenCalledTimes(2);
    await job.stop();
    expect(loop.disable).toHaveBeenCalledTimes(1);
  });

  it('sem start (sem histograma) → eventLoopP99Ms null', async () => {
    const { job, heartbeats } = setup();
    await job.runTick();
    expect(heartbeats.beat).toHaveBeenLastCalledWith(expect.objectContaining({ eventLoopP99Ms: null }));
  });

  it('teto alterado na configuração vale no batimento seguinte, sem recriar o job', async () => {
    const { job, heartbeats, setMax } = setup();
    await job.runTick();
    expect(heartbeats.beat).toHaveBeenLastCalledWith(expect.objectContaining({ maxSessions: 40 }));
    setMax(25);
    await job.runTick();
    expect(heartbeats.beat).toHaveBeenLastCalledWith(expect.objectContaining({ maxSessions: 25 }));
  });
});
