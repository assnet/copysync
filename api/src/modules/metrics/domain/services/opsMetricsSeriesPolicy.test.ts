import { describe, expect, it } from 'vitest';
import { OPS_METRIC } from '../OpsMetric';
import { isOpsMetricName, opsBucketMinutes, opsResourceKind, opsWorkerServiceId } from './opsMetricsSeriesPolicy';

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

  describe('com o id do serviço worker', () => {
    const W = 'srv-ab';
    it.each([
      ['srv-api1', 'api'], // API segue API
      ['srv-api1-5f7d', 'api'],
      ['srv-ab', 'worker_service'], // serviço sem sufixo
      ['srv-ab-1a2b', 'worker_service'], // 1 instância
      ['srv-ab-9z8y', 'worker_service'], // 2ª instância: entra sozinha
      ['srv-abc', 'api'], // id parecido não casa
      ['srv-abc-1a2b', 'api'],
    ])('render/%s → %s', (resource, kind) => {
      expect(opsResourceKind('render', resource, 'memory_pct', W)).toBe(kind);
    });

    it('não mexe em postgres, heartbeat nem consulta', () => {
      expect(opsResourceKind('worker', 'srv-ab-1a2b', 'rss_mb', W)).toBe('worker');
      expect(opsResourceKind('render', 'dpg-x', 'cpu_pct', W)).toBe('postgres');
      expect(opsResourceKind('postgres', '-1', OPS_METRIC.dbStatementTotalMs, W)).toBe('query');
    });

    it('sem a env, todo srv- é API', () => {
      expect(opsResourceKind('render', 'srv-ab-1a2b', 'cpu_pct', null)).toBe('api');
    });
  });
});

describe('opsWorkerServiceId', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['  ', null],
    ['dpg-abc', null],
    ['srv-AB', null],
    ['srv-ab-1', null],
    [' srv-ab ', 'srv-ab'],
  ])('%s → %s', (raw, out) => {
    expect(opsWorkerServiceId(raw)).toBe(out);
  });
});

it('isOpsMetricName aceita só nomes de OPS_METRIC', () => {
  expect(isOpsMetricName('cpu_pct')).toBe(true);
  expect(isOpsMetricName('db_statement_total_ms')).toBe(true);
  expect(isOpsMetricName('cpu_percent')).toBe(false);
  expect(isOpsMetricName('')).toBe(false);
});
