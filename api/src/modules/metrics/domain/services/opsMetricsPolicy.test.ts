import { describe, expect, it } from 'vitest';
import type { OpsMetricReading } from '../OpsMetric';
import { aggregateOpsMetrics } from './aggregateOpsMetrics';
import { cpuSeriesKey, cpuSustained, opsAlerts } from './opsAlertPolicy';

const r = (metric: string, value: number, extra: Partial<OpsMetricReading> = {}): OpsMetricReading =>
  ({ source: 'render', resource: 'srv-1', metric, value, kind: 'gauge', ...extra });
const at = (m: number) => new Date(Date.UTC(2026, 10, 9, 12, m));
const none = { cpuHistory: new Map(), cpuPersisted: new Map(), memoryLimitMb: null };

describe('aggregateOpsMetrics', () => {
  it('gauge = média com min/max/n; counter = último valor', () => {
    const ticks = [10, 20, 30].map((v, i) => ({
      at: at(i),
      readings: [r('cpu_pct', v), r('db_xact_commit', 100 + i, { source: 'postgres', resource: 'db', kind: 'counter' })],
    }));
    const out = aggregateOpsMetrics(ticks, at(5));
    expect(out).toContainEqual({ at: at(5), source: 'render', resource: 'srv-1', metric: 'cpu_pct', value: 20, meta: { min: 10, max: 30, n: 3 } });
    expect(out).toContainEqual({ at: at(5), source: 'postgres', resource: 'db', metric: 'db_xact_commit', value: 102, meta: { n: 3 } });
  });

  it('ignora valor não finito; janela vazia → []', () => {
    expect(aggregateOpsMetrics([{ at: at(0), readings: [r('cpu_pct', NaN)] }], at(1))).toEqual([]);
    expect(aggregateOpsMetrics([], at(1))).toEqual([]);
  });
});

describe('opsAlerts', () => {
  it('memória ≥ 80%, idle in transaction ≥ 3 e event loop ≥ 200 ms; 1 por motivo (o pior)', () => {
    const alerts = opsAlerts({
      ...none,
      current: [
        r('memory_pct', 81), r('memory_pct', 95, { resource: 'srv-2' }), r('memory_pct', 79, { resource: 'srv-3' }),
        r('db_idle_in_transaction', 3, { source: 'postgres', resource: 'db' }),
        r('event_loop_p99_ms', 199, { source: 'worker', resource: 'w1' }),
      ],
    });
    expect(alerts.map((a) => a.reason).sort()).toEqual(['idle_in_transaction', 'memory']);
    expect(alerts.find((a) => a.reason === 'memory')).toMatchObject({ resource: 'srv-2', value: 95, threshold: 80 });
    expect(opsAlerts({ ...none, current: [r('event_loop_p99_ms', 200, { source: 'worker' })] })[0]?.reason).toBe('event_loop');
  });

  it('RSS do worker usa OPS_MEMORY_LIMIT_MB só sem memory_pct da plataforma', () => {
    const rss = r('rss_mb', 820, { source: 'worker', resource: 'w1' });
    expect(opsAlerts({ ...none, memoryLimitMb: 1024, current: [rss] })[0]).toMatchObject({ reason: 'memory', resource: 'w1' });
    expect(opsAlerts({ ...none, memoryLimitMb: null, current: [rss] })).toEqual([]);
    expect(opsAlerts({ ...none, memoryLimitMb: 1024, current: [rss, r('memory_pct', 50)] })).toEqual([]);
  });

  it('CPU só com 5 ticks ≥ 80% ou média persistida ≥ 80% (dono novo)', () => {
    const k = cpuSeriesKey('cpu_pct', 'srv-1');
    const cur = [r('cpu_pct', 90)];
    expect(opsAlerts({ ...none, current: cur, cpuHistory: new Map([[k, [85, 90, 79, 95, 90]]]) })).toEqual([]);
    expect(opsAlerts({ ...none, current: cur, cpuHistory: new Map([[k, [85, 90, 81, 95, 90]]]) })[0]?.reason).toBe('cpu');
    expect(opsAlerts({ ...none, current: cur, cpuHistory: new Map([[k, [90]]]) })).toEqual([]);
    expect(opsAlerts({ ...none, current: cur, cpuHistory: new Map([[k, [90]]]), cpuPersisted: new Map([[k, 82]]) })[0]?.reason).toBe('cpu');
    expect(cpuSustained([90, 90], 70)).toBe(false);
  });
});
