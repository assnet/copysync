import { describe, expect, it, vi } from 'vitest';
import { GetOpsMetricsSeriesUseCase } from './GetOpsMetricsSeriesUseCase';
import type { OpsMetricBucketRow } from '../../domain/contracts/IOpsMetricsSeriesReader';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';

const NOW = new Date('2026-11-09T12:00:00.750Z');
const DAY = 86_400_000;

function build(rows: OpsMetricBucketRow[] = []) {
  const reader = { aggregate: vi.fn(async () => rows) };
  return { uc: new GetOpsMetricsSeriesUseCase(reader, () => NOW), reader };
}

describe('GetOpsMetricsSeriesUseCase', () => {
  it('padrão: cpu_pct + memory_pct, 24 h até agora (sem ms), balde 15 min, sem recurso', async () => {
    const { uc, reader } = build();
    const out = await uc.execute({});
    expect(out.window).toEqual({ from: new Date('2026-11-08T12:00:00.000Z'), to: new Date('2026-11-09T12:00:00.000Z') });
    expect(out.bucketMinutes).toBe(15);
    expect(reader.aggregate).toHaveBeenCalledWith({ metrics: ['cpu_pct', 'memory_pct'], resource: null, ...out.window, bucketMinutes: 15 });
  });

  it('dedup, trim e recurso repassados; 7 dias → balde de 60 min', async () => {
    const { uc, reader } = build();
    const to = new Date('2026-11-09T00:00:00Z');
    const from = new Date(to.getTime() - 7 * DAY);
    const out = await uc.execute({ metrics: ['rss_mb', ' rss_mb', 'db_idle', ''], from, to, resource: 'w1' });
    expect(out.bucketMinutes).toBe(60);
    expect(reader.aggregate).toHaveBeenCalledWith({ metrics: ['rss_mb', 'db_idle'], resource: 'w1', from, to, bucketMinutes: 60 });
  });

  it('recusa métrica desconhecida, mais de 12, from > to e janela > 7 dias sem consultar', async () => {
    const { uc, reader } = build();
    const all = ['cpu', 'cpu_pct', 'memory', 'memory_pct', 'rss_mb', 'node_cpu_pct', 'event_loop_p99_ms', 'db_connections',
      'db_xact_commit', 'db_xact_rollback', 'db_deadlocks', 'db_temp_bytes', 'db_cache_hit_pct'];
    const to = new Date('2026-11-09T00:00:00Z');
    for (const input of [
      { metrics: ['cpu_pct', 'nope'] },
      { metrics: all },
      { from: new Date(to.getTime() + 1), to },
      { from: new Date(to.getTime() - 7 * DAY - 1), to },
    ]) {
      await expect(uc.execute(input)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(reader.aggregate).not.toHaveBeenCalled();
    // exatamente 12 e exatamente 7 dias passam
    await uc.execute({ metrics: all.slice(0, 12), from: new Date(to.getTime() - 7 * DAY), to });
    expect(reader.aggregate).toHaveBeenCalledTimes(1);
  });

  it('agrupa por (source, resource, metric), deriva kind, ordena pontos e arredonda', async () => {
    const t = (m: number) => new Date(Date.UTC(2026, 10, 9, 11, m));
    const { uc } = build([
      { source: 'render', resource: 'srv-a', metric: 'cpu_pct', at: t(15), avg: 10.12345, min: 5, max: 20 },
      { source: 'render', resource: 'srv-a', metric: 'cpu_pct', at: t(0), avg: 1, min: 1, max: 1 },
      { source: 'worker', resource: 'w1', metric: 'rss_mb', at: t(0), avg: 300, min: 290, max: 310 },
      { source: 'render', resource: 'dpg-b', metric: 'cpu_pct', at: t(0), avg: 2, min: 2, max: 2 },
    ]);
    const out = await uc.execute({ metrics: ['cpu_pct', 'rss_mb'] });
    expect(out.series).toEqual([
      { resource: 'srv-a', kind: 'api', metric: 'cpu_pct', points: [
        { at: t(0), avg: 1, min: 1, max: 1 },
        { at: t(15), avg: 10.123, min: 5, max: 20 },
      ] },
      { resource: 'w1', kind: 'worker', metric: 'rss_mb', points: [{ at: t(0), avg: 300, min: 290, max: 310 }] },
      { resource: 'dpg-b', kind: 'postgres', metric: 'cpu_pct', points: [{ at: t(0), avg: 2, min: 2, max: 2 }] },
    ]);
  });
});
