import { describe, expect, it } from 'vitest';
import { OPS_METRIC } from '../OpsMetric';
import { isOpsMetricName, opsBucketMinutes, opsResourceKind } from './opsMetricsSeriesPolicy';

const H = 3_600_000;

describe('opsBucketMinutes', () => {
  it.each([
    [0, 5],
    [H, 5],
    [20 * H, 5], // 1200 min / 240 = 5
    [20 * H + 60_000, 15], // 6 → 15
    [24 * H, 15], // 6 → 15
    [60 * H, 15], // 15
    [61 * H, 30],
    [3 * 24 * H, 30], // 18 → 30
    [7 * 24 * H, 60], // 42 → 60
    [30 * 24 * H, 360], // 180 → 360
    [90 * 24 * H, 360], // acima do maior degrau: fica no maior
  ])('janela %d ms → %d min', (ms, min) => {
    expect(opsBucketMinutes(ms)).toBe(min);
  });
});

describe('opsResourceKind', () => {
  it.each([
    ['render', 'srv-abc', 'cpu_pct', 'api'],
    ['render', 'srv-abc-5f7d', 'memory_pct', 'api'],
    ['render', 'dpg-xyz', 'cpu_pct', 'postgres'],
    ['postgres', 'copysync', 'db_idle', 'postgres'],
    ['postgres', '-123456', OPS_METRIC.dbStatementTotalMs, 'query'],
    ['worker', 'srv-worker-1', 'rss_mb', 'worker'],
    ['render', 'red-123', 'memory_pct', 'other'],
  ])('%s/%s/%s → %s', (source, resource, metric, kind) => {
    expect(opsResourceKind(source, resource, metric)).toBe(kind);
  });
});

it('isOpsMetricName aceita só nomes de OPS_METRIC', () => {
  expect(isOpsMetricName('cpu_pct')).toBe(true);
  expect(isOpsMetricName('db_statement_total_ms')).toBe(true);
  expect(isOpsMetricName('cpu_percent')).toBe(false);
  expect(isOpsMetricName('')).toBe(false);
});
