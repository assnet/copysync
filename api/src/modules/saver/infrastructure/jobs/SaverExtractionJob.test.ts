import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IJobLease } from '../../../../shared/jobs/IJobLease';
import { SAVER_MAINTENANCE_LEASE, SaverExtractionJob, type SaverExtractionJobOptions } from './SaverExtractionJob';
import { startSaverExtractionJob } from './startSaverExtractionJob';

class FakeLease implements IJobLease {
  expires = new Map<string, number>();
  async tryAcquire(name: string, _owner: string, until: Date, now: Date): Promise<boolean> {
    const e = this.expires.get(name);
    if (e !== undefined && e >= now.getTime()) return false;
    this.expires.set(name, until.getTime());
    return true;
  }
  async release(name: string): Promise<void> {
    this.expires.delete(name);
  }
}

function build(over: Partial<SaverExtractionJobOptions> = {}) {
  const calls = { step: [] as string[][], maintenance: 0 };
  let clock = new Date('2026-11-17T12:00:00.000Z');
  const options: SaverExtractionJobOptions = {
    sessions: { ownedSessionIds: async () => ['s1', 's2'] },
    step: () => ({
      execute: async ({ localSessionIds }) => {
        calls.step.push([...localSessionIds]);
        return { processed: 0, outcomes: [], errors: [] };
      },
    }),
    maintenance: {
      execute: async () => {
        calls.maintenance += 1;
        return { cancelledItems: 0, closedExtractions: 0, processed: 0 };
      },
    },
    lease: new FakeLease(),
    now: () => clock,
    ...over,
  };
  const job = new SaverExtractionJob(options);
  return { job, calls, options, advance: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SaverExtractionJob', () => {
  it('tick passa só as sessões deste processo ao passo', async () => {
    const { job, calls } = build();
    await job.runTick();
    expect(calls.step).toEqual([['s1', 's2']]);
  });

  it('sem sessão própria ou engine ausente: não chama o passo', async () => {
    const a = build({ sessions: { ownedSessionIds: async () => [] } });
    await a.job.runTick();
    expect(a.calls.step).toEqual([]);
    const b = build({ step: () => null });
    await b.job.runTick();
    expect(b.calls.maintenance).toBe(1);
  });

  it('sem sobreposição: tick em curso devolve o mesmo e o passo roda uma vez', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let n = 0;
    const { job } = build({
      step: () => ({ execute: async () => { n += 1; await gate; return { processed: 0, outcomes: [], errors: [] }; } }),
    });
    const t1 = job.runTick();
    const t2 = job.runTick();
    expect(t2).toBe(t1);
    release();
    await t1;
    expect(n).toBe(1);
  });

  it('timer de 2 s com timers falsos; stop para o intervalo', async () => {
    vi.useFakeTimers();
    let n = 0;
    const { job } = build({ step: () => ({ execute: async () => { n += 1; return { processed: 0, outcomes: [], errors: [] }; } }) });
    job.start();
    expect(job.started).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(n).toBe(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(n).toBe(3);
    await job.stop();
    expect(job.started).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(n).toBe(3);
  });

  it('manutenção: no máximo 1×/h no cluster, sob o lease saver-maintenance', async () => {
    const lease = new FakeLease();
    const a = build({ lease });
    const b = build({ lease });
    await a.job.runTick();
    await b.job.runTick();
    expect(a.calls.maintenance + b.calls.maintenance).toBe(1);
    expect(lease.expires.has(SAVER_MAINTENANCE_LEASE)).toBe(true);
    // Antes de 1 h ninguém roda de novo
    a.advance(30 * 60_000);
    await a.job.runTick();
    expect(a.calls.maintenance).toBe(1);
    a.advance(31 * 60_000);
    await a.job.runTick();
    expect(a.calls.maintenance).toBe(2);
  });

  it('falha no passo ou na manutenção não lança', async () => {
    const { job } = build({
      sessions: { ownedSessionIds: async () => { throw new Error('db'); } },
      maintenance: { execute: async () => { throw new Error('db'); } },
    });
    await expect(job.runTick()).resolves.toBeUndefined();
  });
});

describe('startSaverExtractionJob', () => {
  it('flag false = job não é montado nem ligado', () => {
    const factory = vi.fn(() => ({ start: vi.fn(), stop: vi.fn(async () => undefined) }));
    expect(startSaverExtractionJob(false, factory)).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('flag true = monta e liga', () => {
    const job = { start: vi.fn(), stop: vi.fn(async () => undefined) };
    expect(startSaverExtractionJob(true, () => job)).toBe(job);
    expect(job.start).toHaveBeenCalledOnce();
  });
});
