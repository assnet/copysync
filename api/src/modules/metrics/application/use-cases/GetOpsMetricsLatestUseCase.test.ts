import { describe, expect, it, vi } from 'vitest';
import { GetOpsMetricsLatestUseCase, OPS_METRICS_LATEST_WINDOW_MS } from './GetOpsMetricsLatestUseCase';
import type { OpsMetricSample } from '../../domain/OpsMetric';
import { OPS_ALERT_THRESHOLDS } from '../../domain/services/opsAlertPolicy';
import { WORKER_ALIVE_MS } from '../../../sessions/domain/services/sessionAdoptionPolicy';

const NOW = new Date('2026-11-09T12:00:00.000Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

function build(rows: OpsMetricSample[], statements: OpsMetricSample[], workerServiceId: string | null = null) {
  const reader = { latestSince: vi.fn(async () => rows), latestStatementSnapshot: vi.fn(async () => statements) };
  const heartbeats = { listAlive: vi.fn(async () => []) };
  return { uc: new GetOpsMetricsLatestUseCase(reader, heartbeats, () => NOW, workerServiceId), reader, heartbeats };
}

describe('GetOpsMetricsLatestUseCase', () => {
  it('último valor com kind, limiares do alerta, top consultas do snapshot e workers vivos', async () => {
    const { uc, reader, heartbeats } = build(
      [
        { at: ago(2), source: 'render', resource: 'srv-a', metric: 'memory_pct', value: 55, meta: { unit: 'pct' } },
        { at: ago(3), source: 'postgres', resource: 'copysync', metric: 'db_idle_in_transaction', value: 1, meta: null },
      ],
      [{ at: ago(4), source: 'postgres', resource: '-77', metric: 'db_statement_total_ms', value: 900.5, meta: { calls: 10, meanMs: 90.05, shape: 'SELECT $1' } },
        { at: ago(4), source: 'postgres', resource: '88', metric: 'db_statement_total_ms', value: 10, meta: null }],
    );
    const out = await uc.execute();
    expect(reader.latestSince).toHaveBeenCalledWith(new Date(NOW.getTime() - OPS_METRICS_LATEST_WINDOW_MS));
    expect(heartbeats.listAlive).toHaveBeenCalledWith(WORKER_ALIVE_MS);
    expect(out.thresholds).toBe(OPS_ALERT_THRESHOLDS);
    expect(out.samplerActive).toBe(true);
    expect(out.latest).toEqual([
      { resource: 'srv-a', kind: 'api', metric: 'memory_pct', value: 55, at: ago(2) },
      { resource: 'copysync', kind: 'postgres', metric: 'db_idle_in_transaction', value: 1, at: ago(3) },
    ]);
    expect(out.topQueries).toEqual([
      { queryid: '-77', shape: 'SELECT $1', totalMs: 900.5, meanMs: 90.05, calls: 10, at: ago(4) },
      { queryid: '88', shape: null, totalMs: 10, meanMs: null, calls: null, at: ago(4) },
    ]);
  });

  it('sem amostra recente: samplerActive false; snapshot antigo de consultas ainda aparece', async () => {
    const old = { at: ago(60), source: 'postgres' as const, resource: '1', metric: 'db_statement_total_ms', value: 5, meta: null };
    const out = await build([], [old]).uc.execute();
    expect(out.samplerActive).toBe(false);
    expect(out.latest).toEqual([]);
    expect(out.topQueries).toHaveLength(1);
  });

  it('com o id do serviço worker: instâncias dele viram worker_service, o resto segue api', async () => {
    const r = (resource: string, value: number) =>
      ({ at: ago(2), source: 'render' as const, resource, metric: 'memory_pct', value, meta: null });
    const out = await build([r('srv-api', 40), r('srv-wk-a1', 60), r('srv-wk-b2', 70)], [], 'srv-wk').uc.execute();
    expect(out.latest.map((l) => [l.resource, l.kind])).toEqual([
      ['srv-api', 'api'], ['srv-wk-a1', 'worker_service'], ['srv-wk-b2', 'worker_service'],
    ]);
  });

  it('instâncias do worker: amostra da Render casada com o batimento pelo sufixo; sem serviço = vazio', async () => {
    const r = (resource: string, metric: string, value: number) =>
      ({ at: ago(1), source: 'render' as const, resource, metric, value, meta: null });
    const rows = [r('srv-wk-a1b2c', 'cpu_pct', 20), r('srv-wk-a1b2c', 'memory_pct', 50), r('srv-api', 'cpu_pct', 90)];
    const beat = { workerId: 'srv-wk-7d9f-a1b2c-19-0011aabb', role: 'worker', sessions: 4, pendingLogins: 0, maxSessions: 40, rssMb: 300, seenAt: ago(0.5) };
    const { uc, heartbeats } = build(rows, [], 'srv-wk');
    heartbeats.listAlive.mockResolvedValue([beat] as never);
    const out = await uc.execute();
    expect(out.workerInstances).toEqual([
      { instance: 'a1b2c', resource: 'srv-wk-a1b2c', cpuPct: 20, memoryPct: 50, sampledAt: ago(1), heartbeat: expect.objectContaining({ sessions: 4 }) },
    ]);
    expect((await build(rows, []).uc.execute()).workerInstances).toEqual([]);
  });
});
