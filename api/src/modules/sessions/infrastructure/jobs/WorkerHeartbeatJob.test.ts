import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IWorkerHeartbeatRepository } from '../../domain/contracts/IWorkerHeartbeatRepository';
import { WorkerHeartbeatJob } from './WorkerHeartbeatJob';

function setup() {
  const heartbeats = {
    beat: vi.fn(async () => undefined),
    listAlive: vi.fn(async () => []),
    remove: vi.fn(async () => undefined),
  } satisfies IWorkerHeartbeatRepository;
  let local = ['s1', 's2'];
  let pending = 3;
  const job = new WorkerHeartbeatJob({
    heartbeats, workerId: 'w1', role: 'worker', maxSessions: 40,
    occupancy: () => ({ sessions: local.length, pendingLogins: pending }), rssMb: () => 321,
  });
  return { job, heartbeats, setLocal: (ids: string[]) => { local = ids; }, setPending: (n: number) => { pending = n; } };
}

afterEach(() => vi.useRealTimers());

describe('WorkerHeartbeatJob', () => {
  it('bate no start e a cada 20 s com sessões locais, teto e RSS', async () => {
    vi.useFakeTimers();
    const { job, heartbeats, setLocal, setPending } = setup();
    job.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeats.beat).toHaveBeenLastCalledWith({ workerId: 'w1', role: 'worker', sessions: 2, pendingLogins: 3, maxSessions: 40, rssMb: 321 });
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
});
