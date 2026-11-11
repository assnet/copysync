import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IJobLease } from '../../../../shared/jobs/IJobLease';
import type { IWorkerHeartbeatRepository } from '../../../sessions/domain/contracts/IWorkerHeartbeatRepository';
import type { IOpsMetricsSampleRepository } from '../../domain/contracts/IOpsMetricsSampleRepository';
import type { OpsMetricReading, OpsMetricSample } from '../../domain/OpsMetric';
import {
  OPS_ALERT_SILENCE_MS,
  OPS_RETENTION_MS,
  OPS_SAMPLER_LEASE,
  OPS_SAMPLER_LEASE_TTL_MS,
  OpsMetricsSamplerJob,
} from './OpsMetricsSamplerJob';

/** Mesma semântica do `PrismaJobLease`: só adquire livre ou vencido, mesmo para o dono. */
function memoryLease() {
  const rows = new Map<string, { ownerId: string; expiresAt: Date }>();
  const lease = {
    tryAcquire: vi.fn(async (name: string, ownerId: string, until: Date, now: Date) => {
      const cur = rows.get(name);
      if (cur && cur.expiresAt >= now) return false;
      rows.set(name, { ownerId, expiresAt: until });
      return true;
    }),
    release: vi.fn(async (name: string, ownerId: string) => {
      if (rows.get(name)?.ownerId === ownerId) rows.delete(name);
    }),
  } satisfies IJobLease;
  return { lease, rows };
}

function memorySamples() {
  const rows: OpsMetricSample[] = [];
  const repo = {
    insertMany: vi.fn(async (s: readonly OpsMetricSample[]) => { rows.push(...s); return s.length; }),
    deleteOlderThan: vi.fn(async (cutoff: Date) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.at < cutoff) rows.splice(i, 1);
      return before - rows.length;
    }),
    listSince: vi.fn(async (metric: string, since: Date) =>
      rows.filter((r) => r.metric === metric && r.at >= since).sort((a, b) => b.at.getTime() - a.at.getTime())),
  } satisfies IOpsMetricsSampleRepository;
  return { repo, rows };
}

const reading = (metric: string, value: number, extra: Partial<OpsMetricReading> = {}): OpsMetricReading =>
  ({ source: 'render', resource: 'srv-1', metric, value, kind: 'gauge', ...extra });

const T0 = new Date('2026-11-09T12:00:00Z').getTime();
const MIN = 60_000;

function setup(opts: { lease?: ReturnType<typeof memoryLease>; samples?: ReturnType<typeof memorySamples>; tickTimeoutMs?: number } = {}) {
  const lease = opts.lease ?? memoryLease();
  const samples = opts.samples ?? memorySamples();
  let platformReadings: OpsMetricReading[] = [reading('cpu_pct', 10), reading('memory_pct', 50)];
  let dbReadings: OpsMetricReading[] = [reading('db_idle_in_transaction', 0, { source: 'postgres', resource: 'db' })];
  const platform = { read: vi.fn(async (_signal?: AbortSignal) => platformReadings) };
  const database = { read: vi.fn(async () => dbReadings) };
  const heartbeats = {
    beat: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    hasAlive: vi.fn(async () => true),
    listAlive: vi.fn(async () => [{
      workerId: 'w1', role: 'worker', sessions: 1, pendingLogins: 0, maxSessions: 40, rssMb: 300,
      cpuPct: 12, eventLoopP99Ms: 30, seenAt: new Date(T0),
    }]),
  } satisfies IWorkerHeartbeatRepository;
  let clock = T0;
  const job = new OpsMetricsSamplerJob({
    lease: lease.lease, samples: samples.repo, heartbeats, platform, database, now: () => new Date(clock),
    tickTimeoutMs: opts.tickTimeoutMs,
  });
  return {
    job, lease, samples, platform, database, heartbeats,
    setClock: (ms: number) => { clock = ms; },
    setPlatform: (r: OpsMetricReading[]) => { platformReadings = r; },
    setDb: (r: OpsMetricReading[]) => { dbReadings = r; },
  };
}

/** Roda `n` ticks, um por minuto a partir de `from`. */
async function ticks(s: ReturnType<typeof setup>, n: number, from = T0) {
  for (let i = 0; i < n; i++) {
    s.setClock(from + i * MIN);
    await s.job.runTick();
  }
}

afterEach(() => vi.restoreAllMocks());

describe('OpsMetricsSamplerJob', () => {
  it('lê as 3 fontes por tick e persiste 1 linha por série a cada 5 ticks', async () => {
    const s = setup();
    await ticks(s, 4);
    expect(s.platform.read).toHaveBeenCalledTimes(4);
    expect(s.samples.repo.insertMany).not.toHaveBeenCalled();
    await ticks(s, 1, T0 + 4 * MIN);
    expect(s.samples.repo.insertMany).toHaveBeenCalledTimes(1);
    const metrics = s.samples.rows.map((r) => `${r.source}:${r.metric}`).sort();
    expect(metrics).toEqual([
      'postgres:db_idle_in_transaction', 'render:cpu_pct', 'render:memory_pct',
      'worker:event_loop_p99_ms', 'worker:node_cpu_pct', 'worker:rss_mb',
    ]);
    expect(s.samples.rows.find((r) => r.metric === 'cpu_pct')).toMatchObject({ value: 10, meta: { n: 5 }, at: new Date(T0 + 4 * MIN) });
    await ticks(s, 5, T0 + 5 * MIN);
    expect(s.samples.repo.insertMany).toHaveBeenCalledTimes(2);
  });

  it('fonte de sessões entra no tick; falha dela só loga e as outras seguem', async () => {
    const lease = memoryLease();
    const samples = memorySamples();
    const sessions = { read: vi.fn(async (): Promise<OpsMetricReading[]> => [
      reading('sessions_connected', 3, { source: 'sessions', resource: 'cluster' }),
    ]) };
    const base = setup({ lease, samples });
    let clock = T0;
    const job = new OpsMetricsSamplerJob({
      lease: lease.lease, samples: samples.repo, heartbeats: base.heartbeats, platform: base.platform,
      database: base.database, sessions, now: () => new Date(clock),
    });
    await job.runTick();
    sessions.read.mockRejectedValueOnce(new Error('db down'));
    for (let i = 1; i < 5; i++) {
      clock = T0 + i * MIN;
      await job.runTick();
    }
    expect(sessions.read).toHaveBeenCalledTimes(5);
    const row = samples.rows.find((r) => r.metric === 'sessions_connected');
    expect(row).toMatchObject({ source: 'sessions', resource: 'cluster', value: 3, meta: { n: 4 } });
    expect(samples.rows.some((r) => r.metric === 'cpu_pct')).toBe(true);
  });

  it('apaga > 7 dias no mesmo tick da persistência', async () => {
    const samples = memorySamples();
    const old = { source: 'render' as const, resource: 'srv-1', metric: 'cpu_pct', value: 1, meta: null };
    samples.rows.push({ ...old, at: new Date(T0 - OPS_RETENTION_MS - 1) }, { ...old, at: new Date(T0 - OPS_RETENTION_MS + 10 * MIN) });
    const s = setup({ samples });
    await ticks(s, 5);
    expect(s.samples.repo.deleteOlderThan).toHaveBeenCalledWith(new Date(T0 + 4 * MIN - OPS_RETENTION_MS));
    expect(samples.rows.some((r) => r.at.getTime() === T0 - OPS_RETENTION_MS - 1)).toBe(false);
    expect(samples.rows.some((r) => r.at.getTime() === T0 - OPS_RETENTION_MS + 10 * MIN)).toBe(true);
  });

  it('falha da Render ou do Postgres só loga; a amostra segue com as outras fontes', async () => {
    const s = setup();
    s.platform.read.mockRejectedValue(new Error('render down'));
    s.database.read.mockRejectedValueOnce(new Error('pg down'));
    await expect(ticks(s, 5)).resolves.toBeUndefined();
    const metrics = new Set(s.samples.rows.map((r) => r.metric));
    expect(metrics.has('cpu_pct')).toBe(false);
    expect(metrics.has('rss_mb')).toBe(true);
    expect(metrics.has('db_idle_in_transaction')).toBe(true);
  });

  it('dois jobs com o mesmo lease: só um amostra; stop solta o lease e o outro assume', async () => {
    const lease = memoryLease();
    const a = setup({ lease });
    const b = setup({ lease });
    for (let i = 0; i < 3; i++) {
      a.setClock(T0 + i * MIN); b.setClock(T0 + i * MIN);
      await a.job.runTick();
      await b.job.runTick();
    }
    expect(a.platform.read).toHaveBeenCalledTimes(3);
    expect(b.platform.read).not.toHaveBeenCalled();
    await a.job.stop();
    expect(lease.rows.has(OPS_SAMPLER_LEASE)).toBe(false);
    b.setClock(T0 + 3 * MIN);
    await b.job.runTick();
    expect(b.platform.read).toHaveBeenCalledTimes(1);
  });

  it('alerta 1× por limiar a cada 30 min, mesmo com 2 workers', async () => {
    const lease = memoryLease();
    const a = setup({ lease });
    const b = setup({ lease });
    const warns: unknown[][] = [];
    const log = (a.job as unknown as { log: { warn: (...x: unknown[]) => void } }).log;
    vi.spyOn(log, 'warn').mockImplementation((...x: unknown[]) => { warns.push(x); });
    for (const s of [a, b]) s.setDb([reading('db_idle_in_transaction', 4, { source: 'postgres', resource: 'db' })]);
    await ticks(a, 3);
    const alerts = () => warns.filter((w) => w[1] === 'ops metrics alert');
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]![0]).toMatchObject({ reason: 'idle_in_transaction', value: 4, threshold: 3 });
    expect(lease.rows.get('ops-alert:idle_in_transaction')!.expiresAt).toEqual(new Date(T0 + OPS_ALERT_SILENCE_MS));
    // Outro processo vira dono: o silêncio vale no cluster
    await a.job.stop();
    await ticks(b, 3, T0 + 3 * MIN);
    expect(b.database.read).toHaveBeenCalled();
    const bWarn = vi.spyOn((b.job as unknown as { log: { warn: () => void } }).log, 'warn');
    await ticks(b, 1, T0 + 10 * MIN);
    expect(bWarn.mock.calls.filter((c) => (c as unknown[])[1] === 'ops metrics alert')).toHaveLength(0);
    // Depois de 30 min alerta de novo
    await ticks(b, 1, T0 + 31 * MIN);
    expect(bWarn.mock.calls.filter((c) => (c as unknown[])[1] === 'ops metrics alert')).toHaveLength(1);
  });

  it('CPU alta só alerta após 5 min sustentados', async () => {
    const s = setup();
    const warn = vi.spyOn((s.job as unknown as { log: { warn: () => void } }).log, 'warn');
    s.setPlatform([reading('cpu_pct', 95)]);
    await ticks(s, 4);
    const cpu = () => warn.mock.calls.filter((c) => (c as unknown[])[1] === 'ops metrics alert'
      && ((c as unknown[])[0] as { reason: string }).reason === 'cpu');
    expect(cpu()).toHaveLength(0);
    await ticks(s, 1, T0 + 4 * MIN);
    expect(cpu()).toHaveLength(1);
  });

  it('stop cancela a leitura da Render em voo e não lança', async () => {
    const s = setup();
    s.platform.read.mockImplementation((signal?: AbortSignal) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }) as Promise<OpsMetricReading[]>);
    const tick = s.job.runTick();
    await vi.waitFor(() => expect(s.platform.read).toHaveBeenCalled());
    await expect(s.job.stop()).resolves.toBeUndefined();
    await tick;
    expect(s.lease.lease.release).toHaveBeenCalledWith(OPS_SAMPLER_LEASE, expect.any(String));
  });
  it('lease tomado por outro no meio do tick: renova antes do persist, perdeu → não grava', async () => {
    const s = setup();
    await ticks(s, 4);
    s.platform.read.mockImplementationOnce(async () => {
      // Tick passou do TTL e outro processo virou dono
      s.lease.rows.set(OPS_SAMPLER_LEASE, { ownerId: 'other', expiresAt: new Date(T0 + 60 * MIN) });
      return [reading('cpu_pct', 10)];
    });
    await ticks(s, 1, T0 + 4 * MIN);
    expect(s.samples.repo.insertMany).not.toHaveBeenCalled();
    expect(s.samples.repo.deleteOlderThan).not.toHaveBeenCalled();
    expect(s.lease.rows.get(OPS_SAMPLER_LEASE)?.ownerId).toBe('other');
  });

  it('persist renova o lease do próprio dono (novo vencimento a partir de agora)', async () => {
    const s = setup();
    await ticks(s, 5);
    expect(s.samples.repo.insertMany).toHaveBeenCalledTimes(1);
    expect(s.lease.rows.get(OPS_SAMPLER_LEASE)?.expiresAt).toEqual(new Date(T0 + 4 * MIN + OPS_SAMPLER_LEASE_TTL_MS));
  });

  it('coleta acima do teto do tick: descarta a amostra sem lançar nem persistir', async () => {
    const s = setup({ tickTimeoutMs: 20 });
    s.database.read.mockImplementation(() => new Promise<OpsMetricReading[]>(() => undefined));
    await expect(ticks(s, 5)).resolves.toBeUndefined();
    expect(s.samples.repo.insertMany).not.toHaveBeenCalled();
    s.database.read.mockImplementation(async () => []);
    await ticks(s, 5, T0 + 5 * MIN);
    expect(s.samples.repo.insertMany).toHaveBeenCalledTimes(1);
  });

  describe('alerta de ocupação de sessões (WSCALE-17)', () => {
    function occupancySetup(opts: { connected: number; capacity: number; adoption?: boolean; ratio?: number }) {
      const base = setup();
      let ratio = opts.ratio ?? 0.85;
      let adoption = opts.adoption ?? false;
      let tick = 0;
      const sessions = { read: vi.fn(async (): Promise<OpsMetricReading[]> => [
        reading('sessions_connected', opts.connected, { source: 'sessions', resource: 'cluster' }),
        reading('sessions_capacity', opts.capacity, { source: 'sessions', resource: 'cluster' }),
      ]) };
      const job = new OpsMetricsSamplerJob({
        lease: base.lease.lease, samples: base.samples.repo, heartbeats: base.heartbeats, platform: base.platform,
        // Relógio avança 1 min por leitura: o lease do sampler vence entre ticks
        database: base.database, sessions, now: () => new Date(T0 + (tick++) * MIN),
        adoptionEnabled: () => adoption, occupancyAlertRatio: () => ratio,
      });
      const warns: unknown[][] = [];
      vi.spyOn((job as unknown as { log: { warn: (...x: unknown[]) => void } }).log, 'warn')
        .mockImplementation((...x: unknown[]) => { warns.push(x); });
      const alerts = () => warns.filter((w) => w[1] === 'ops metrics alert').map((w) => w[0]);
      return {
        job, lease: base.lease, alerts,
        setRatio: (v: number) => { ratio = v; },
        setAdoption: (v: boolean) => { adoption = v; },
      };
    }

    it('sem adoção e acima do limiar: alerta só log com o lease de silêncio', async () => {
      const s = occupancySetup({ connected: 36, capacity: 40 });
      await s.job.runTick();
      expect(s.alerts()).toEqual([expect.objectContaining({ reason: 'session_occupancy', value: 90, threshold: 85 })]);
      expect(s.lease.rows.has('ops-alert:session_occupancy')).toBe(true);
    });

    it('igual ou abaixo do limiar: sem alerta', async () => {
      for (const connected of [34, 20]) {
        const s = occupancySetup({ connected, capacity: 40, ratio: 0.85 });
        await s.job.runTick();
        expect(s.alerts()).toEqual([]);
      }
      const eq = occupancySetup({ connected: 17, capacity: 20, ratio: 0.85 });
      await eq.job.runTick();
      expect(eq.alerts()).toEqual([]);
    });

    it('com adoção ligada não alerta (WorkerCapacityAlertJob cobre)', async () => {
      const s = occupancySetup({ connected: 40, capacity: 40, adoption: true });
      await s.job.runTick();
      expect(s.alerts()).toEqual([]);
      expect(s.lease.rows.has('ops-alert:session_occupancy')).toBe(false);
    });

    it('limiar e adoção lidos a cada tick', async () => {
      const s = occupancySetup({ connected: 32, capacity: 40, ratio: 0.9, adoption: true });
      await s.job.runTick();
      s.setAdoption(false);
      await s.job.runTick();
      expect(s.alerts()).toEqual([]);
      s.setRatio(0.75);
      await s.job.runTick();
      expect(s.alerts()).toEqual([expect.objectContaining({ reason: 'session_occupancy', value: 80, threshold: 75 })]);
    });

    it('capacidade 0: sem alerta', async () => {
      const s = occupancySetup({ connected: 5, capacity: 0 });
      await s.job.runTick();
      expect(s.alerts()).toEqual([]);
    });
  });
});
