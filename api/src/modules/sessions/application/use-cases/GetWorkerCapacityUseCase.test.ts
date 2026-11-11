import { describe, it, expect, vi } from 'vitest';
import { CAPACITY_WINDOW_MS, GetWorkerCapacityUseCase, memoryToMb, type GetWorkerCapacityDeps } from './GetWorkerCapacityUseCase';
import type { WorkerCapacityPlanRow } from '../../domain/contracts/IWorkerCapacityReader';
import type { OpsMetricSample, OpsMetricSource } from '../../../metrics/domain/OpsMetric';
import type { WorkerScalingSettings } from '../../domain/services/workerScalingSettings';
import { OCCUPANCY_SAMPLE_MAX_AGE_MS } from '../../domain/services/capacityPlan';

const now = new Date('2026-11-11T12:00:00.000Z');
const t = (min: number) => new Date(now.getTime() - min * 60_000);

const settings: WorkerScalingSettings = {
  maxSessionsPerWorker: 40,
  maxPendingLoginsPerWorker: 50,
  alertOccupancyRatio: 0.5,
  awaitingAlertSeconds: 120,
  scalerMode: 'off',
  minReplicas: 1,
  maxReplicas: 3,
  scaleUpSustainSeconds: 900,
  scaleCooldownSeconds: 1800,
};

const row: WorkerCapacityPlanRow = {
  planSlug: 'pro',
  tenants: 3,
  contracted: { whatsapp: 6, telegram: 2 },
  unlimitedTenants: { whatsapp: 1, telegram: 0 },
  created: { whatsapp: 5, telegram: 1 },
  connected: { whatsapp: 4, telegram: 1 },
};

const s = (
  metric: string, at: Date, value: number, resource = 'cluster', source: OpsMetricSource = 'sessions', meta: OpsMetricSample['meta'] = null,
): OpsMetricSample => ({ at, source, resource, metric, value, meta });

function build(samples: OpsMetricSample[], over: Partial<GetWorkerCapacityDeps> = {}) {
  const listSince = vi.fn(async (metric: string, since: Date) => samples.filter((x) => x.metric === metric && x.at >= since));
  const uc = new GetWorkerCapacityUseCase({
    reader: { readByPlan: async () => [row] },
    samples: { listSince },
    settings: async () => ({ settings, enforced: true }),
    renderServiceIds: ['srv-a'],
    now: () => now,
    ...over,
  });
  return { uc, listSince };
}

const sessions = [
  s('sessions_connected', t(10), 20), s('sessions_connected', t(5), 30),
  s('sessions_capacity', t(10), 80), s('sessions_capacity', t(5), 80),
];
const mem = (at: Date, value: number, unit: string, resource = 'srv-a') => s('memory', at, value, resource, 'render', { unit });
const pct = (at: Date, value: number, resource = 'srv-a') => s('memory_pct', at, value, resource, 'render');

describe('memoryToMb', () => {
  it('converte por unidade (base 1024) e rejeita desconhecida', () => {
    expect(memoryToMb(2048, 'KB')).toBe(2);
    expect(memoryToMb(512, 'MB')).toBe(512);
    expect(memoryToMb(1.5, 'GB')).toBe(1536);
    expect(memoryToMb(1048576, 'bytes')).toBe(1);
    expect(memoryToMb(1048576, ' BYTES ')).toBe(1);
    expect(memoryToMb(1048576, 'b')).toBe(1);
    expect(memoryToMb(1, 'xyz')).toBeNull();
    expect(memoryToMb(1, null)).toBeNull();
  });
});

describe('GetWorkerCapacityUseCase', () => {
  it('sem amostra: zeros, memória null e sampledAt null; planos e configuração seguem', async () => {
    const { uc, listSince } = build([]);
    const out = await uc.execute();
    expect(listSince).toHaveBeenCalledWith('sessions_connected', new Date(now.getTime() - CAPACITY_WINDOW_MS));
    expect(out.cluster).toEqual({
      capacity: 0, connected: 0, occupancyPct: 0, headroom: 0, requiredReplicas: 1,
      mbPerSession: null, suggestedMaxSessions: null, memoryLimitMb: null, sampledAt: null, stale: false,
    });
    expect(out.plans).toEqual([{
      planSlug: 'pro', tenants: 3,
      whatsapp: { contracted: 6, unlimitedTenants: 1, created: 5, connected: 4 },
      telegram: { contracted: 2, unlimitedTenants: 0, created: 1, connected: 1 },
    }]);
    expect(out.settings).toEqual({ maxSessionsPerWorker: 40, alertOccupancyRatio: 0.5 });
    expect(out.enforced).toBe(true);
  });

  it('com amostra: última sessions_* e MB por sessão com instâncias somadas', async () => {
    const { uc } = build([
      ...sessions,
      // duas instâncias srv- por at: 250 MB + 250 MB = 500 MB (mesmo limite, 1000 MB); recurso dpg- ignorado
      // formato real: `meta.unit = 'bytes'`, recurso `srv-<serviço>-<sufixo>` por instância
      mem(t(10), 262144000, 'bytes', 'srv-a-stl6v'), mem(t(10), 262144000, 'bytes', 'srv-a-x9k2p'),
      mem(t(5), 262144000, 'bytes', 'srv-a-stl6v'), mem(t(5), 262144000, 'bytes', 'srv-a-x9k2p'),
      pct(t(5), 25, 'srv-a-stl6v'), pct(t(5), 25, 'srv-a-x9k2p'),
      mem(t(5), 10484711424, 'bytes', 'dpg-x'),
      s('sessions_connected', t(5), 999, 'srv-a', 'render'),
    ]);
    const { cluster } = await uc.execute();
    expect(cluster.connected).toBe(30);
    expect(cluster.capacity).toBe(80);
    expect(cluster.occupancyPct).toBe(37.5);
    expect(cluster.headroom).toBe(50);
    expect(cluster.requiredReplicas).toBe(2); // ceil(30 ÷ (40 × 0,5))
    expect(cluster.sampledAt).toBe(t(5).toISOString());
    expect(cluster.stale).toBe(false);
    // 500 MB ÷ média de conectadas 25 ((20 + 30) ÷ 2) = 20 MB/sessão; limite 250 ÷ 0,25 = 1000 MB
    expect(cluster.mbPerSession).toBe(20);
    expect(cluster.memoryLimitMb).toBe(1000);
    expect(cluster.suggestedMaxSessions).toBe(35); // floor(0,7 × 1000 ÷ 20)
  });

  it('amostra mais velha que 10 min: números mantidos e stale = true; no limite, false', async () => {
    const at = (ms: number) => new Date(now.getTime() - ms);
    const old = build([s('sessions_connected', at(OCCUPANCY_SAMPLE_MAX_AGE_MS + 1), 30), s('sessions_capacity', at(OCCUPANCY_SAMPLE_MAX_AGE_MS + 1), 80)]);
    expect((await old.uc.execute()).cluster).toMatchObject({ connected: 30, capacity: 80, occupancyPct: 37.5, stale: true });
    const edge = build([s('sessions_connected', at(OCCUPANCY_SAMPLE_MAX_AGE_MS), 30), s('sessions_capacity', at(OCCUPANCY_SAMPLE_MAX_AGE_MS), 80)]);
    expect((await edge.uc.execute()).cluster.stale).toBe(false);
  });

  it.each([
    ['bytes', 512 * 1024 * 1024],
    [' Bytes ', 512 * 1024 * 1024],
    ['byte', 512 * 1024 * 1024],
    ['B', 512 * 1024 * 1024],
    ['KB', 512 * 1024],
    ['MB', 512],
    ['GB', 0.5],
  ])('unidade %s convertida para MB', async (unit, value) => {
    const { uc } = build([...sessions, mem(t(5), value, unit), pct(t(5), 50)]);
    const { cluster } = await uc.execute();
    expect(cluster.mbPerSession).toBeCloseTo(512 / 25, 2);
    expect(cluster.memoryLimitMb).toBe(1024);
  });

  it('unidade desconhecida: amostra fora, memória null', async () => {
    const { uc } = build([...sessions, mem(t(5), 1, 'parsecs'), pct(t(5), 50)]);
    expect((await uc.execute()).cluster).toMatchObject({ mbPerSession: null, memoryLimitMb: null, suggestedMaxSessions: null });
  });

  it('mais de um srv- monitorado: memória null sem ler as amostras', async () => {
    const { uc, listSince } = build([...sessions, mem(t(5), 512, 'MB'), pct(t(5), 50)], { renderServiceIds: ['srv-a', 'srv-b'] });
    const { cluster } = await uc.execute();
    expect(cluster).toMatchObject({ connected: 30, mbPerSession: null, memoryLimitMb: null, suggestedMaxSessions: null });
    expect(listSince.mock.calls.map((c) => c[0])).not.toContain('memory');
  });

  it('sessões 0: MB por sessão null, limite ainda medido', async () => {
    const { uc } = build([s('sessions_connected', t(5), 0), s('sessions_capacity', t(5), 40), mem(t(5), 512, 'MB'), pct(t(5), 50)]);
    const { cluster } = await uc.execute();
    expect(cluster).toMatchObject({
      connected: 0, capacity: 40, occupancyPct: 0, headroom: 40, requiredReplicas: 1,
      mbPerSession: null, suggestedMaxSessions: null, memoryLimitMb: 1024, sampledAt: t(5).toISOString(),
    });
  });
});
