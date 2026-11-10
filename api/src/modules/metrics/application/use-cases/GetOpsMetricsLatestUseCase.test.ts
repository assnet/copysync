import { describe, expect, it, vi } from 'vitest';
import { GetOpsMetricsLatestUseCase, OPS_METRICS_LATEST_WINDOW_MS } from './GetOpsMetricsLatestUseCase';
import type { OpsMetricSample } from '../../domain/OpsMetric';
import { OPS_ALERT_THRESHOLDS } from '../../domain/services/opsAlertPolicy';
import { WORKER_ALIVE_MS } from '../../../sessions/domain/services/sessionAdoptionPolicy';

const NOW = new Date('2026-11-09T12:00:00.000Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

function build(rows: OpsMetricSample[], statements: OpsMetricSample[]) {
  const reader = { latestSince: vi.fn(async () => rows), latestStatementSnapshot: vi.fn(async () => statements) };
  const heartbeats = { listAlive: vi.fn(async () => []) };
  return { uc: new GetOpsMetricsLatestUseCase(reader, heartbeats, () => NOW), reader, heartbeats };
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
});
