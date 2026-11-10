import { describe, it, expect, vi } from 'vitest';
import { ListOpsMetricsUseCase, OPS_METRICS_PAGE_SIZE } from './ListOpsMetricsUseCase';
import type { IOpsMetricsSampleReader } from '../../domain/contracts/IOpsMetricsSampleRepository';
import type { OpsMetricSample } from '../../domain/OpsMetric';
import { WORKER_ALIVE_MS } from '../../../sessions/domain/services/sessionAdoptionPolicy';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';

const NOW = new Date('2026-11-09T12:00:00.750Z');
const sample = (i: number): OpsMetricSample => ({
  at: new Date(NOW.getTime() - i * 300_000), source: 'render', resource: 'srv-a', metric: 'cpu_pct', value: i, meta: null,
});

function build(total = 3) {
  const rows = Array.from({ length: total }, (_, i) => sample(i));
  const reader = { listPage: vi.fn(async (_f, offset: number, limit: number) => rows.slice(offset, offset + limit)) } satisfies IOpsMetricsSampleReader;
  const heartbeats = { listAlive: vi.fn(async () => []) };
  return { uc: new ListOpsMetricsUseCase(reader, heartbeats, () => NOW), reader, heartbeats };
}

describe('ListOpsMetricsUseCase', () => {
  it('sem filtros: janela de 24 h até agora (sem ms), todas as métricas, workers vivos', async () => {
    const { uc, reader, heartbeats } = build();
    const out = await uc.execute({});
    expect(out.window.to.toISOString()).toBe('2026-11-09T12:00:00.000Z');
    expect(out.window.from.toISOString()).toBe('2026-11-08T12:00:00.000Z');
    expect(reader.listPage).toHaveBeenCalledWith({ metric: null, from: out.window.from, to: out.window.to }, 0, OPS_METRICS_PAGE_SIZE + 1);
    expect(heartbeats.listAlive).toHaveBeenCalledWith(WORKER_ALIVE_MS);
    expect(out.samples).toHaveLength(3);
    expect(out.nextCursor).toBeNull();
  });

  it('repassa metric/from/to', async () => {
    const { uc, reader } = build();
    const from = new Date('2026-11-09T00:00:00Z');
    const to = new Date('2026-11-09T06:00:00Z');
    await uc.execute({ metric: 'memory_pct', from, to });
    expect(reader.listPage).toHaveBeenCalledWith({ metric: 'memory_pct', from, to }, 0, OPS_METRICS_PAGE_SIZE + 1);
  });

  it('pagina por cursor amarrado à janela; cursor de outra janela recomeça', async () => {
    const { uc, reader } = build(OPS_METRICS_PAGE_SIZE + 2);
    const first = await uc.execute({});
    expect(first.samples).toHaveLength(OPS_METRICS_PAGE_SIZE);
    expect(first.nextCursor).toEqual(expect.any(String));

    const { from, to } = first.window;
    const second = await uc.execute({ from, to, cursor: first.nextCursor! });
    expect(reader.listPage).toHaveBeenLastCalledWith(expect.anything(), OPS_METRICS_PAGE_SIZE, OPS_METRICS_PAGE_SIZE + 1);
    expect(second.samples).toHaveLength(2);
    expect(second.nextCursor).toBeNull();

    await uc.execute({ metric: 'cpu_pct', from, to, cursor: first.nextCursor! });
    expect(reader.listPage).toHaveBeenLastCalledWith(expect.anything(), 0, OPS_METRICS_PAGE_SIZE + 1);
    await uc.execute({ cursor: 'lixo.assinatura' });
    expect(reader.listPage).toHaveBeenLastCalledWith(expect.anything(), 0, OPS_METRICS_PAGE_SIZE + 1);
  });

  it('recusa from > to e janela acima de 7 dias sem consultar', async () => {
    const { uc, reader } = build();
    await expect(uc.execute({ from: new Date('2026-11-09T10:00:00Z'), to: new Date('2026-11-09T09:00:00Z') })).rejects.toBeInstanceOf(ValidationError);
    await expect(uc.execute({ from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-08T00:00:01Z') })).rejects.toBeInstanceOf(ValidationError);
    expect(reader.listPage).not.toHaveBeenCalled();
  });
});
