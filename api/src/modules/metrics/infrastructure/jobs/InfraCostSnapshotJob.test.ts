import { describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock('../../../../shared/logger/logger', () => ({ logger: { child: () => log } }));

import type { IJobLease } from '../../../../shared/jobs/IJobLease';
import type {
  IInfraCostSnapshotRepository,
  InfraFxRateRecord,
  InfraResourceHourSnapshot,
  TenantSessionHourSample,
} from '../../domain/contracts/IInfraCostSnapshotRepository';
import type {
  IInfraResourcePlanReader,
  InfraRenderResult,
  InfraResourcePlanReading,
} from '../../domain/contracts/IInfraResourcePlanReader';
import type { IInfraFxFetchStateRepository } from '../../domain/contracts/IInfraFxFetchStateRepository';
import type { FetchedFxRate, IFxRateSource } from '../../domain/services/fxRate';
import type { InfraRenderKey } from '../../domain/services/infraCostSettings';
import { defaultInfraCostSettings } from '../../domain/services/infraCostSettings';
import type { InfraFxFetchState } from '../../domain/services/infraFxFetchState';
import { INFRA_COST_RENDER_BACKOFF_LEASE, INFRA_COST_SNAPSHOT_LEASE, InfraCostSnapshotJob } from './InfraCostSnapshotJob';
import { startInfraCostSnapshotJob } from '../infraCostSnapshotStart';

const HOUR = 3_600_000;

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

/** Mesma semântica do repositório Prisma (guardas de hora). */
function memorySnapshots() {
  const hours = new Map<string, InfraResourceHourSnapshot>();
  const sessions = new Map<string, { connectedHours: number; lastHour: number }>();
  const usage = new Map<string, { value: number; lastHour: number | null }>();
  const fx: InfraFxRateRecord[] = [];
  const repo = {
    hasResourceHour: vi.fn(async (h: Date) => [...hours.values()].some((r) => r.hour.getTime() === h.getTime())),
    upsertResourceHours: vi.fn(async (rows: readonly InfraResourceHourSnapshot[]) => {
      for (const r of rows) hours.set(`${r.hour.toISOString()}|${r.resourceKey}`, r);
      return rows.length;
    }),
    addSessionHour: vi.fn(async (h: Date, samples: readonly TenantSessionHourSample[]) => {
      let n = 0;
      for (const s of samples) {
        const k = `${h.toISOString().slice(0, 10)}|${s.tenantId}`;
        const cur = sessions.get(k);
        if (cur && cur.lastHour >= h.getTime()) continue;
        sessions.set(k, { connectedHours: (cur?.connectedHours ?? 0) + s.connectedSessions, lastHour: h.getTime() });
        n += 1;
      }
      return n;
    }),
    upsertFxRate: vi.fn(async (r: InfraFxRateRecord) => { fx.push(r); }),
    latestFxRate: vi.fn(async () => fx.at(-1) ?? null),
    addUsageHour: vi.fn(async (h: Date, v) => {
      const k = `${h.toISOString().slice(0, 10)}|${v.metric}|${v.resourceKey}`;
      const cur = usage.get(k);
      if (cur && cur.lastHour !== null && cur.lastHour >= h.getTime()) return false;
      usage.set(k, { value: (cur?.value ?? 0) + v.value, lastHour: h.getTime() });
      return true;
    }),
    lastUsageHour: vi.fn(async (metric: string, since: Date) => {
      const hs = [...usage.entries()]
        .filter(([k, v]) => k.split('|')[1] === metric && v.lastHour !== null && v.lastHour >= since.getTime())
        .map(([, v]) => v.lastHour!);
      return hs.length ? new Date(Math.max(...hs)) : null;
    }),
    usageKeys: vi.fn(async (metric: string, from: Date, to: Date, minLastHour?: Date) => {
      const [a, b] = [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)];
      const keys = [...usage.entries()]
        .map(([k, v]) => ({ parts: k.split('|'), v }))
        .filter(({ parts: [day, m], v }) =>
          m === metric && day >= a && day < b && (!minLastHour || (v.lastHour !== null && v.lastHour >= minLastHour.getTime())))
        .map(({ parts }) => parts[2] as InfraRenderKey);
      return [...new Set(keys)].sort();
    }),
    upsertUsageDay: vi.fn(async (v) => {
      usage.set(`${v.day.toISOString().slice(0, 10)}|${v.metric}|${v.resourceKey}`, { value: v.value, lastHour: null });
    }),
    deleteOlderThan: vi.fn(async () => ({ resourceHours: 0, sessionHours: 0, fxRates: 0, usageDaily: 0 })),
  } satisfies IInfraCostSnapshotRepository;
  return { repo, hours, sessions, usage, fx };
}

const reading = (key: InfraRenderKey, over: Partial<InfraResourcePlanReading> = {}): InfraResourcePlanReading => ({
  resourceKey: key, resourceType: key === 'postgres' ? 'postgres' : 'service', plan: 'standard', instances: 2, diskGb: null, suspended: false, ...over,
});

function fakePlans(keys: InfraRenderKey[] = ['api', 'worker', 'postgres']) {
  let fail: InfraRenderResult<never> | null = null;
  const plans = {
    configuredKeys: vi.fn(() => keys),
    readResource: vi.fn(async (key: InfraRenderKey) =>
      fail ?? ({ status: 'ok', reading: reading(key, key === 'postgres' ? { plan: 'basic_1gb', instances: 1, diskGb: 15.4 } : {}) } as const)),
    readBandwidthGb: vi.fn(async () => ({ status: 'ok', byKey: { api: 0.5, worker: null }, discardedSeries: 0 } as const)),
    readBuildMinutes: vi.fn(async () => ({ status: 'ok', byKey: { api: 12.5, worker: 3 } } as Extract<InfraRenderResult<{ byKey: Partial<Record<InfraRenderKey, number>> }>, { status: 'ok' }>)),
  } satisfies IInfraResourcePlanReader;
  return { plans, setFail: (f: InfraRenderResult<never> | null) => { fail = f; } };
}

function memoryFxState() {
  let state: InfraFxFetchState | null = null;
  const repo = {
    get: vi.fn(async () => (state ? { ...state } : null)),
    save: vi.fn(async (s: InfraFxFetchState) => { state = { ...s }; }),
  } satisfies IInfraFxFetchStateRepository;
  return { repo, get: () => state };
}

const source = (name: 'ptax' | 'sgs', result: FetchedFxRate | null): IFxRateSource & { fetchLatest: ReturnType<typeof vi.fn> } =>
  ({ name, fetchLatest: vi.fn(async () => result) });

interface SetupOpts {
  lease?: ReturnType<typeof memoryLease>;
  snapshots?: ReturnType<typeof memorySnapshots>;
  fxState?: ReturnType<typeof memoryFxState>;
  plans?: ReturnType<typeof fakePlans>;
  workerSamples?: number | null;
  fxSources?: IFxRateSource[];
  auto?: boolean;
  start?: number;
  monthClose?: { execute: ReturnType<typeof vi.fn> };
  /** Meses (`YYYY-MM`) com snapshot além dos das horas gravadas. */
  dataMonths?: string[];
}

function setup(opts: SetupOpts = {}) {
  const lease = opts.lease ?? memoryLease();
  const snapshots = opts.snapshots ?? memorySnapshots();
  const fxState = opts.fxState ?? memoryFxState();
  const plans = opts.plans ?? fakePlans();
  const live = { workerInstancesInHour: vi.fn(async () => (opts.workerSamples === undefined ? 3 : opts.workerSamples)) };
  const tenants = { readHour: vi.fn(async () => [{ tenantId: 't1', planSlug: 'COPYSYNC_PRO', connectedSessions: 2, contractedSessions: 3 }]) };
  const value = defaultInfraCostSettings();
  value.fx.auto = opts.auto ?? true;
  const settings = { get: vi.fn(async () => ({ value, updatedAt: new Date(0), updatedById: null })), save: vi.fn() };
  const fxSources = opts.fxSources ?? [source('ptax', { rate: 5.4321, referenceDate: '2026-11-12', source: 'ptax' })];
  let clock = opts.start ?? Date.parse('2026-11-12T10:02:00Z');
  // Mesma semântica do Prisma: mês com snapshot (horas gravadas ou semeado) e ainda não fechado, o mais antigo
  const closed = new Set<string>();
  const months = {
    oldestUnclosedMonth: vi.fn(async (from: Date, to: Date) => {
      const all = new Set([...(opts.dataMonths ?? []), ...[...snapshots.hours.values()].map((r) => r.hour.toISOString().slice(0, 7))]);
      const [a, b] = [from.toISOString().slice(0, 7), to.toISOString().slice(0, 7)];
      const open = [...all].filter((m) => m >= a && m < b && !closed.has(m)).sort();
      return open.length ? new Date(`${open[0]}-01T00:00:00Z`) : null;
    }),
  };
  const monthClose = opts.monthClose && {
    execute: async (input: { month: string }) => {
      const r = await (opts.monthClose!.execute as (i: unknown) => Promise<string>)(input);
      if (r === 'closed' || r === 'already_closed') closed.add(input.month);
      return r;
    },
  };
  const job = new InfraCostSnapshotJob({
    lease: lease.lease, snapshots: snapshots.repo, plans: plans.plans, live, tenants, settings: settings as never,
    fxSources, fxState: fxState.repo, now: () => new Date(clock), monthClose: monthClose as never, months,
  });
  return { job, lease, snapshots, fxState, plans, live, tenants, settings, months, setClock: (ms: number) => { clock = ms; } };
}

describe('InfraCostSnapshotJob — hora fechada', () => {
  it('grava a hora anterior: recursos, sessão-hora e banda; worker pelas amostras, resto pela Render', async () => {
    log.warn.mockClear();
    const s = setup();
    await s.job.runTick();
    const h9 = '2026-11-12T09:00:00.000Z';
    expect([...s.snapshots.hours.values()].map((r) => [r.hour.toISOString(), r.resourceKey, r.instances, r.instancesSource, r.plan, r.diskGb]))
      .toEqual([
        [h9, 'api', 2, 'render', 'standard', null],
        [h9, 'worker', 3, 'samples', 'standard', null],
        [h9, 'postgres', 1, 'render', 'basic_1gb', 15],
      ]);
    expect(s.live.workerInstancesInHour).toHaveBeenCalledWith(new Date(h9), new Date('2026-11-12T10:00:00Z'));
    expect(s.snapshots.sessions.get('2026-11-12|t1')).toEqual({ connectedHours: 2, lastHour: Date.parse(h9) });
    // Banda das horas fechadas há mais de 1 h sem linha, até 6 h para trás: [03:00, 04:00) … [08:00, 09:00)
    expect(s.plans.plans.readBandwidthGb).toHaveBeenCalledTimes(6);
    expect(s.plans.plans.readBandwidthGb).toHaveBeenNthCalledWith(1, new Date('2026-11-12T03:00:00Z'), new Date('2026-11-12T04:00:00Z'));
    expect(s.plans.plans.readBandwidthGb).toHaveBeenLastCalledWith(new Date('2026-11-12T08:00:00Z'), new Date(h9));
    expect(s.snapshots.usage.get('2026-11-12|bandwidth_gb|api')).toEqual({ value: 3, lastHour: Date.parse('2026-11-12T08:00:00Z') });
    expect(s.snapshots.usage.has('2026-11-12|bandwidth_gb|worker')).toBe(false);
  });

  it('amostras zeradas → instâncias do worker pela Render (fallback)', async () => {
    const s = setup({ workerSamples: null });
    await s.job.runTick();
    const worker = [...s.snapshots.hours.values()].find((r) => r.resourceKey === 'worker');
    expect(worker).toMatchObject({ instances: 2, instancesSource: 'render' });
  });

  it('hora já gravada: o tick seguinte não relê nada nem dobra', async () => {
    const s = setup();
    await s.job.runTick();
    s.setClock(Date.parse('2026-11-12T10:07:01Z'));
    await s.job.runTick();
    expect(s.plans.plans.readResource).toHaveBeenCalledTimes(3);
    expect(s.tenants.readHour).toHaveBeenCalledTimes(1);
    expect(s.snapshots.sessions.get('2026-11-12|t1')?.connectedHours).toBe(2);
  });

  it('Render fora → hora sem linha, warn único na sequência, sessão-hora gravada uma vez; volta na leitura seguinte', async () => {
    log.warn.mockClear();
    const plans = fakePlans();
    plans.setFail({ status: 'unavailable', reason: 'rate_limited', retryAfterSeconds: 30 });
    const s = setup({ plans });
    await s.job.runTick();
    s.setClock(Date.parse('2026-11-12T10:07:01Z'));
    await s.job.runTick();
    expect(s.snapshots.hours.size).toBe(0);
    expect(s.snapshots.repo.upsertResourceHours).not.toHaveBeenCalled();
    expect(s.plans.plans.readBandwidthGb).not.toHaveBeenCalled();
    const renderWarns = log.warn.mock.calls.filter((c) => c[1] === 'infra cost hour without render reading');
    expect(renderWarns).toEqual([[{ reason: 'rate_limited' }, 'infra cost hour without render reading']]);
    expect(s.snapshots.sessions.get('2026-11-12|t1')?.connectedHours).toBe(2);

    plans.setFail(null);
    s.setClock(Date.parse('2026-11-12T10:12:02Z'));
    await s.job.runTick();
    expect(s.snapshots.hours.size).toBe(3);
    expect(s.snapshots.sessions.get('2026-11-12|t1')?.connectedHours).toBe(2);
  });

  it('429 com Retry-After: pausa gravada no lease; nenhuma chamada à Render até vencer; sessão-hora segue', async () => {
    const plans = fakePlans();
    plans.setFail({ status: 'unavailable', reason: 'rate_limited', retryAfterSeconds: 600 });
    const s = setup({ plans, start: Date.parse('2026-11-12T10:02:00Z') });
    await s.job.runTick();
    expect(s.lease.rows.get(INFRA_COST_RENDER_BACKOFF_LEASE)?.expiresAt).toEqual(new Date('2026-11-12T10:12:00Z'));
    expect(s.snapshots.sessions.get('2026-11-12|t1')?.connectedHours).toBe(2);
    expect(plans.plans.readResource).toHaveBeenCalledTimes(1);
    s.setClock(Date.parse('2026-11-12T10:07:01Z'));
    await s.job.runTick();
    expect(plans.plans.readResource).toHaveBeenCalledTimes(1);
    expect(plans.plans.readBandwidthGb).not.toHaveBeenCalled();
    plans.setFail(null);
    s.setClock(Date.parse('2026-11-12T10:12:01Z'));
    await s.job.runTick();
    expect(plans.plans.readResource).toHaveBeenCalledTimes(4);
    expect(s.snapshots.hours.size).toBe(3);
  });

  it('429 sem cabeçalho: pausa de 60 s; build também respeita a pausa', async () => {
    const plans = fakePlans();
    plans.setFail({ status: 'unavailable', reason: 'rate_limited', retryAfterSeconds: null });
    const s = setup({ plans, start: Date.parse('2026-11-12T10:02:00Z') });
    await s.job.runTick();
    expect(s.lease.rows.get(INFRA_COST_RENDER_BACKOFF_LEASE)?.expiresAt).toEqual(new Date('2026-11-12T10:03:00Z'));
    expect(plans.plans.readBuildMinutes).not.toHaveBeenCalled();
  });

  it('recurso sem instâncias = falha: hora sem linha (tudo-ou-nada); worker coberto pelas amostras passa', async () => {
    const plans = fakePlans();
    plans.plans.readResource.mockImplementation(async (key: InfraRenderKey) =>
      ({ status: 'ok', reading: reading(key, key === 'api' ? { instances: null } : {}) }) as const);
    const s = setup({ plans });
    await s.job.runTick();
    expect(s.snapshots.hours.size).toBe(0);
    expect(s.snapshots.sessions.size).toBe(1);

    const plans2 = fakePlans();
    plans2.plans.readResource.mockImplementation(async (key: InfraRenderKey) =>
      ({ status: 'ok', reading: reading(key, key === 'worker' ? { instances: null } : {}) }) as const);
    const s2 = setup({ plans: plans2 });
    await s2.job.runTick();
    expect([...s2.snapshots.hours.values()].find((r) => r.resourceKey === 'worker')).toMatchObject({ instances: 3, instancesSource: 'samples' });
    const s3 = setup({ plans: plans2, workerSamples: null });
    await s3.job.runTick();
    expect(s3.snapshots.hours.size).toBe(0);
  });

  it('banda indisponível numa hora: reprocessada no tick seguinte, sem dobrar', async () => {
    const s = setup();
    await s.job.runTick();
    const bw = s.plans.plans.readBandwidthGb;
    bw.mockResolvedValueOnce({ status: 'unavailable', reason: 'upstream' } as never);
    s.setClock(Date.parse('2026-11-12T11:02:00Z'));
    await s.job.runTick();
    expect(bw).toHaveBeenCalledTimes(7);
    expect(s.snapshots.usage.get('2026-11-12|bandwidth_gb|api')?.value).toBe(3);
    s.setClock(Date.parse('2026-11-12T11:07:01Z'));
    await s.job.runTick();
    expect(bw).toHaveBeenCalledTimes(8);
    expect(bw).toHaveBeenLastCalledWith(new Date('2026-11-12T09:00:00Z'), new Date('2026-11-12T10:00:00Z'));
    expect(s.snapshots.usage.get('2026-11-12|bandwidth_gb|api')).toEqual({ value: 3.5, lastHour: Date.parse('2026-11-12T09:00:00Z') });
    s.setClock(Date.parse('2026-11-12T11:12:02Z'));
    await s.job.runTick();
    expect(bw).toHaveBeenCalledTimes(8);
  });

  it('sem Render configurada: nenhuma chamada sai, só a sessão-hora', async () => {
    const s = setup({ plans: fakePlans([]) });
    await s.job.runTick();
    expect(s.plans.plans.readResource).not.toHaveBeenCalled();
    expect(s.plans.plans.readBuildMinutes).not.toHaveBeenCalled();
    expect(s.snapshots.hours.size).toBe(0);
    expect(s.snapshots.sessions.size).toBe(1);
  });

  it('troca de dono do lease no meio da hora não dobra', async () => {
    const lease = memoryLease();
    const snapshots = memorySnapshots();
    const fxState = memoryFxState();
    const a = setup({ lease, snapshots, fxState });
    await a.job.runTick();
    // Dono A morre sem soltar; B assume depois do TTL
    const b = setup({ lease, snapshots, fxState, start: Date.parse('2026-11-12T10:07:00Z') });
    await b.job.runTick();
    expect(lease.rows.get(INFRA_COST_SNAPSHOT_LEASE)).toBeDefined();
    expect(b.plans.plans.readResource).not.toHaveBeenCalled();
    expect(snapshots.repo.upsertResourceHours).toHaveBeenCalledTimes(1);
    expect(snapshots.sessions.get('2026-11-12|t1')?.connectedHours).toBe(2);
  });

  it('lease de outro processo vivo: não faz nada', async () => {
    const lease = memoryLease();
    lease.rows.set(INFRA_COST_SNAPSHOT_LEASE, { ownerId: 'outro', expiresAt: new Date('2026-11-12T11:00:00Z') });
    const s = setup({ lease });
    await s.job.runTick();
    expect(s.snapshots.repo.hasResourceHour).not.toHaveBeenCalled();
    expect(s.tenants.readHour).not.toHaveBeenCalled();
  });

  it('perdeu o lease antes de gravar: não grava', async () => {
    const lease = memoryLease();
    const s = setup({ lease });
    s.tenants.readHour.mockImplementation(async () => {
      lease.rows.set(INFRA_COST_SNAPSHOT_LEASE, { ownerId: 'outro', expiresAt: new Date('2026-11-12T11:00:00Z') });
      return [];
    });
    await s.job.runTick();
    expect(s.snapshots.repo.addSessionHour).not.toHaveBeenCalled();
    expect(s.snapshots.hours.size).toBe(0);
  });

  it('lease renovado antes de cada passo: perdeu depois da hora → banda, build, cotação e retenção não rodam', async () => {
    const lease = memoryLease();
    const ptax = source('ptax', { rate: 5, referenceDate: '2026-11-12', source: 'ptax' });
    const s = setup({ lease, fxSources: [ptax], start: Date.parse('2026-11-12T17:02:00Z') });
    s.snapshots.repo.upsertResourceHours.mockImplementationOnce(async (rows) => {
      lease.rows.set(INFRA_COST_SNAPSHOT_LEASE, { ownerId: 'outro', expiresAt: new Date('2026-11-12T18:00:00Z') });
      return rows.length;
    });
    await s.job.runTick();
    expect(s.snapshots.repo.upsertResourceHours).toHaveBeenCalledTimes(1);
    expect(s.plans.plans.readBandwidthGb).not.toHaveBeenCalled();
    expect(s.plans.plans.readBuildMinutes).not.toHaveBeenCalled();
    expect(ptax.fetchLatest).not.toHaveBeenCalled();
    expect(s.snapshots.repo.deleteOlderThan).not.toHaveBeenCalled();
  });
});

describe('InfraCostSnapshotJob — build, retenção', () => {
  it('build do dia anterior 1×/dia após 01:00 UTC; falha tenta de novo 1 h depois', async () => {
    const plans = fakePlans();
    plans.plans.readBuildMinutes.mockResolvedValueOnce({ status: 'unavailable', reason: 'upstream' } as never);
    const s = setup({ plans, start: Date.parse('2026-11-12T00:30:00Z') });
    await s.job.runTick();
    expect(plans.plans.readBuildMinutes).not.toHaveBeenCalled();
    s.setClock(Date.parse('2026-11-12T01:05:00Z'));
    await s.job.runTick();
    expect(plans.plans.readBuildMinutes).toHaveBeenCalledTimes(1);
    s.setClock(Date.parse('2026-11-12T01:35:00Z'));
    await s.job.runTick();
    expect(plans.plans.readBuildMinutes).toHaveBeenCalledTimes(1);
    s.setClock(Date.parse('2026-11-12T02:06:00Z'));
    await s.job.runTick();
    expect(plans.plans.readBuildMinutes).toHaveBeenCalledTimes(2);
    expect(plans.plans.readBuildMinutes).toHaveBeenLastCalledWith(new Date('2026-11-11T00:00:00Z'), new Date('2026-11-12T00:00:00Z'));
    expect(s.snapshots.usage.get('2026-11-11|build_minutes|api')).toEqual({ value: 12.5, lastHour: null });
    s.setClock(Date.parse('2026-11-12T23:55:00Z'));
    await s.job.runTick();
    expect(plans.plans.readBuildMinutes).toHaveBeenCalledTimes(2);
    s.setClock(Date.parse('2026-11-13T01:01:00Z'));
    await s.job.runTick();
    expect(plans.plans.readBuildMinutes).toHaveBeenCalledTimes(3);
  });

  it('build com valor nulo de um serviço mapeado: grava os outros, warn e nova tentativa em 1 h (sem a trava do dia)', async () => {
    log.warn.mockClear();
    const plans = fakePlans();
    plans.plans.readBuildMinutes.mockResolvedValue({ status: 'ok', byKey: { api: 12.5, worker: null } } as never);
    const s = setup({ plans, start: Date.parse('2026-11-12T01:05:00Z') });
    await s.job.runTick();
    expect(s.snapshots.usage.get('2026-11-11|build_minutes|api')).toEqual({ value: 12.5, lastHour: null });
    expect(s.snapshots.usage.has('2026-11-11|build_minutes|worker')).toBe(false);
    expect(log.warn).toHaveBeenCalledWith({ missing: ['worker'] }, 'infra cost build minutes incomplete, retry in 1 h');
    s.setClock(Date.parse('2026-11-12T01:40:00Z'));
    await s.job.runTick();
    expect(plans.plans.readBuildMinutes).toHaveBeenCalledTimes(1);
    s.setClock(Date.parse('2026-11-12T02:06:00Z'));
    await s.job.runTick();
    expect(plans.plans.readBuildMinutes).toHaveBeenCalledTimes(2);
  });

  it('retenção de 400 dias 1×/24 h', async () => {
    const s = setup();
    await s.job.runTick();
    s.setClock(Date.parse('2026-11-12T10:07:01Z'));
    await s.job.runTick();
    expect(s.snapshots.repo.deleteOlderThan).toHaveBeenCalledTimes(1);
    expect(s.snapshots.repo.deleteOlderThan).toHaveBeenCalledWith(new Date(Date.parse('2026-11-12T10:02:00Z') - 400 * 24 * HOUR));
  });
});

describe('InfraCostSnapshotJob — cotação', () => {
  const at = (iso: string) => Date.parse(`2026-11-12T${iso}Z`);

  it('antes de 16h30 UTC não busca; depois grava a PTAX e marca o dia como feito', async () => {
    const ptax = source('ptax', { rate: 5.4321, referenceDate: '2026-11-12', source: 'ptax' });
    const s = setup({ fxSources: [ptax], start: at('16:29:00') });
    await s.job.runTick();
    expect(ptax.fetchLatest).not.toHaveBeenCalled();
    s.setClock(at('16:35:00'));
    await s.job.runTick();
    expect(s.snapshots.fx).toEqual([{ referenceDate: new Date('2026-11-12T00:00:00Z'), rate: 5.4321, source: 'ptax', fetchedAt: new Date(at('16:35:00')) }]);
    expect(s.fxState.get()).toMatchObject({ referenceDay: '2026-11-12', attempts: 1, ok: true });
    s.setClock(at('18:00:00'));
    await s.job.runTick();
    expect(ptax.fetchLatest).toHaveBeenCalledTimes(1);
  });

  it('PTAX falha → SGS', async () => {
    const ptax = source('ptax', null);
    const sgs = source('sgs', { rate: 5.5, referenceDate: '2026-11-11', source: 'sgs' });
    const s = setup({ fxSources: [ptax, sgs], start: at('16:31:00') });
    await s.job.runTick();
    expect(s.snapshots.fx.map((r) => r.source)).toEqual(['sgs']);
  });

  it('PTAX e SGS falhando: uma nova tentativa 1 h depois, e o estado sobrevive a reinício', async () => {
    const lease = memoryLease();
    const snapshots = memorySnapshots();
    const fxState = memoryFxState();
    const ptax = source('ptax', null);
    const sgs = source('sgs', null);
    const a = setup({ lease, snapshots, fxState, fxSources: [ptax, sgs], start: at('16:31:00') });
    await a.job.runTick();
    expect(fxState.get()).toMatchObject({ attempts: 1, ok: false });
    await a.job.stop();

    // Reinício: processo novo, mesmo estado no banco
    const b = setup({ lease, snapshots, fxState, fxSources: [ptax, sgs], start: at('17:00:00') });
    await b.job.runTick();
    expect(ptax.fetchLatest).toHaveBeenCalledTimes(1);
    b.setClock(at('17:31:00'));
    await b.job.runTick();
    expect(ptax.fetchLatest).toHaveBeenCalledTimes(2);
    expect(sgs.fetchLatest).toHaveBeenCalledTimes(2);
    expect(fxState.get()).toMatchObject({ attempts: 2, ok: false });
    b.setClock(at('20:00:00'));
    await b.job.runTick();
    expect(ptax.fetchLatest).toHaveBeenCalledTimes(2);
    expect(snapshots.fx).toEqual([]);
  });

  it('fx.auto desligado: não busca', async () => {
    const ptax = source('ptax', { rate: 5, referenceDate: '2026-11-12', source: 'ptax' });
    const s = setup({ fxSources: [ptax], auto: false, start: at('17:00:00') });
    await s.job.runTick();
    expect(ptax.fetchLatest).not.toHaveBeenCalled();
    expect(s.fxState.get()).toBeNull();
  });
});

describe('InfraCostSnapshotJob — ciclo de vida', () => {
  it('stop solta o lease; nunca lança com repositório quebrado', async () => {
    const s = setup();
    s.snapshots.repo.hasResourceHour.mockRejectedValue(new Error('db down'));
    await expect(s.job.runTick()).resolves.toBeUndefined();
    await s.job.stop();
    expect(s.lease.rows.has(INFRA_COST_SNAPSHOT_LEASE)).toBe(false);
  });

  it('flag desligada não cria nem liga o job', () => {
    const factory = vi.fn();
    expect(startInfraCostSnapshotJob(false, factory)).toBeNull();
    expect(factory).not.toHaveBeenCalled();
    const job = { start: vi.fn() };
    expect(startInfraCostSnapshotJob(true, () => ({ job, renderConfigured: false }) as never)).toMatchObject({ job });
    expect(job.start).toHaveBeenCalledTimes(1);
  });
});

describe('InfraCostSnapshotJob — fechamento mensal', () => {
  const close = () => ({ execute: vi.fn(async () => 'closed') });

  it('fecha depois da banda e do build no mesmo tick: 01:05 grava a banda das 23:00 e o build do último dia, depois fecha', async () => {
    const monthClose = close();
    const s = setup({ start: Date.parse('2026-11-01T00:03:00Z'), monthClose });
    await s.job.runTick();
    expect(s.snapshots.hours.size).toBeGreaterThan(0); // 31/10 23:00 gravada no passo da hora
    expect(monthClose.execute).not.toHaveBeenCalled(); // banda das 23:00 só a partir de 01:00

    s.setClock(Date.parse('2026-11-01T01:05:00Z'));
    await s.job.runTick();
    expect(monthClose.execute).toHaveBeenCalledTimes(1);
    expect(monthClose.execute).toHaveBeenCalledWith({ month: '2026-10', now: new Date('2026-11-01T01:05:00Z') });
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => Math.max(...fn.mock.invocationCallOrder);
    const closedAt = monthClose.execute.mock.invocationCallOrder[0]!;
    expect(order(s.plans.plans.readBandwidthGb)).toBeLessThan(closedAt);
    expect(order(s.plans.plans.readBuildMinutes)).toBeLessThan(closedAt);
    expect(s.snapshots.usage.get('2026-10-31|bandwidth_gb|api')?.lastHour).toBe(Date.parse('2026-10-31T23:00:00Z'));
    expect(s.snapshots.usage.has('2026-10-31|build_minutes|api')).toBe(true);
  });

  it('banda da última hora ausente: adia; ao chegar, fecha sem aviso', async () => {
    const monthClose = close();
    const s = setup({ start: Date.parse('2026-11-01T01:05:00Z'), monthClose, dataMonths: ['2026-10'] });
    s.plans.plans.readBandwidthGb.mockResolvedValue({ status: 'unavailable', reason: 'upstream' } as never);
    await s.job.runTick();
    s.setClock(Date.parse('2026-11-01T03:00:00Z'));
    await s.job.runTick();
    expect(monthClose.execute).not.toHaveBeenCalled();
    expect(s.snapshots.usage.has('2026-10-31|build_minutes|api')).toBe(true); // build já veio

    s.plans.plans.readBandwidthGb.mockResolvedValue({ status: 'ok', byKey: { api: 0.5 }, discardedSeries: 0 } as never);
    s.setClock(Date.parse('2026-11-01T03:05:00Z'));
    await s.job.runTick();
    expect(monthClose.execute).toHaveBeenCalledWith({ month: '2026-10', now: new Date('2026-11-01T03:05:00Z') });
  });

  it('fim do prazo (23:00 do dia 1) sem banda nem build: fecha assim mesmo com usage_incomplete; depois das 24 h não tenta', async () => {
    const monthClose = close();
    const plans = fakePlans();
    plans.plans.readBandwidthGb.mockResolvedValue({ status: 'unavailable', reason: 'upstream' } as never);
    plans.plans.readBuildMinutes.mockResolvedValue({ status: 'unavailable', reason: 'upstream' } as never);
    const s = setup({ start: Date.parse('2026-11-01T01:10:00Z'), monthClose, plans, dataMonths: ['2026-10'] });
    await s.job.runTick();
    s.setClock(Date.parse('2026-11-01T22:55:00Z'));
    await s.job.runTick();
    expect(monthClose.execute).not.toHaveBeenCalled();

    s.setClock(Date.parse('2026-11-01T23:00:00Z'));
    await s.job.runTick();
    expect(monthClose.execute).toHaveBeenCalledWith({
      month: '2026-10', now: new Date('2026-11-01T23:00:00Z'), incompleteUsage: ['bandwidth', 'build'],
    });
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ month: '2026-10' }), 'infra cost month closed without full usage');

    s.setClock(Date.parse('2026-11-02T00:10:00Z'));
    await s.job.runTick();
    expect(monthClose.execute).toHaveBeenCalledTimes(1);
  });

  it('sem Render: até 01:00 espera; depois fecha sem esperar banda nem build; fora das 24 h não tenta', async () => {
    const monthClose = close();
    const s = setup({ start: Date.parse('2026-11-01T00:30:00Z'), monthClose, plans: fakePlans([]), dataMonths: ['2026-10'] });
    await s.job.runTick();
    expect(monthClose.execute).not.toHaveBeenCalled();

    s.setClock(Date.parse('2026-11-01T01:10:00Z'));
    await s.job.runTick();
    expect(monthClose.execute).toHaveBeenCalledWith({ month: '2026-10', now: new Date('2026-11-01T01:10:00Z') });

    s.setClock(Date.parse('2026-11-15T10:00:00Z'));
    await s.job.runTick();
    expect(monthClose.execute).toHaveBeenCalledTimes(1);
  });

  it('falha do fechamento não derruba os outros passos', async () => {
    const monthClose = { execute: vi.fn(async () => { throw new Error('boom'); }) };
    const s = setup({ start: Date.parse('2026-11-01T01:05:00Z'), monthClose, dataMonths: ['2026-10'] });
    await s.job.runTick();
    expect(monthClose.execute).toHaveBeenCalled();
    expect(s.snapshots.repo.deleteOlderThan).toHaveBeenCalled();
  });
  it('worker parado no dia 1: fora da janela fecha direto com usage_incomplete, mês mais antigo primeiro, 1 por tick', async () => {
    log.warn.mockClear();
    const monthClose = close();
    const plans = fakePlans();
    plans.plans.readBandwidthGb.mockResolvedValue({ status: 'unavailable', reason: 'upstream' } as never);
    plans.plans.readBuildMinutes.mockResolvedValue({ status: 'unavailable', reason: 'upstream' } as never);
    // Fora dos 12 meses ('2025-10') não entra
    const s = setup({ start: Date.parse('2026-11-05T10:02:00Z'), monthClose, plans, dataMonths: ['2025-10', '2026-08', '2026-10'] });
    await s.job.runTick();
    expect(s.months.oldestUnclosedMonth).toHaveBeenCalledWith(new Date('2025-11-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));
    expect(monthClose.execute).toHaveBeenCalledTimes(1);
    expect(monthClose.execute).toHaveBeenLastCalledWith({
      month: '2026-08', now: new Date('2026-11-05T10:02:00Z'), incompleteUsage: ['bandwidth', 'build'],
    });
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ month: '2026-08', late: true }), 'infra cost month closed without full usage');

    s.setClock(Date.parse('2026-11-05T10:07:01Z'));
    await s.job.runTick();
    expect(monthClose.execute).toHaveBeenLastCalledWith(expect.objectContaining({ month: '2026-10', incompleteUsage: ['bandwidth', 'build'] }));
    s.setClock(Date.parse('2026-11-05T10:12:02Z'));
    await s.job.runTick();
    expect(monthClose.execute).toHaveBeenCalledTimes(2);
  });

  it('fora da janela com banda e build completos: fecha sem aviso', async () => {
    const monthClose = close();
    const s = setup({ start: Date.parse('2026-11-03T10:02:00Z'), monthClose, dataMonths: ['2026-10'] });
    const last = Date.parse('2026-10-31T23:00:00Z');
    for (const key of ['api', 'worker']) {
      s.snapshots.usage.set(`2026-10-31|bandwidth_gb|${key}`, { value: 1, lastHour: last });
      s.snapshots.usage.set(`2026-10-31|build_minutes|${key}`, { value: 1, lastHour: null });
    }
    await s.job.runTick();
    expect(monthClose.execute).toHaveBeenCalledWith({ month: '2026-10', now: new Date('2026-11-03T10:02:00Z') });
  });

  it('banda por serviço: um serviço com banda no mês sem a última hora conta como incompleto (não vale "algum recurso")', async () => {
    const monthClose = close();
    const s = setup({ start: Date.parse('2026-11-03T10:02:00Z'), monthClose, dataMonths: ['2026-10'] });
    s.snapshots.usage.set('2026-10-31|bandwidth_gb|api', { value: 1, lastHour: Date.parse('2026-10-31T23:00:00Z') });
    s.snapshots.usage.set('2026-10-31|bandwidth_gb|worker', { value: 1, lastHour: Date.parse('2026-10-31T21:00:00Z') });
    // postgres (não `srv-`) não tem banda nem build: nunca esperado
    for (const key of ['api', 'worker']) s.snapshots.usage.set(`2026-10-31|build_minutes|${key}`, { value: 1, lastHour: null });
    await s.job.runTick();
    expect(monthClose.execute).toHaveBeenCalledWith({ month: '2026-10', now: new Date('2026-11-03T10:02:00Z'), incompleteUsage: ['bandwidth'] });
  });

  it('build por serviço: falta o de um serviço mapeado → incompleto', async () => {
    const monthClose = close();
    const s = setup({ start: Date.parse('2026-11-03T10:02:00Z'), monthClose, dataMonths: ['2026-10'] });
    for (const key of ['api', 'worker']) s.snapshots.usage.set(`2026-10-31|bandwidth_gb|${key}`, { value: 1, lastHour: Date.parse('2026-10-31T23:00:00Z') });
    s.snapshots.usage.set('2026-10-31|build_minutes|api', { value: 1, lastHour: null });
    await s.job.runTick();
    expect(monthClose.execute).toHaveBeenCalledWith({ month: '2026-10', now: new Date('2026-11-03T10:02:00Z'), incompleteUsage: ['build'] });
  });
});
