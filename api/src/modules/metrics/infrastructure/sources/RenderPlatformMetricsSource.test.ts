import { describe, expect, it, vi } from 'vitest';
import { RenderPlatformMetricsSource, lastPoints } from './RenderPlatformMetricsSource';

const series = (resource: string, values: number[], extra: { field: string; value: string }[] = []) => ({
  labels: [{ field: 'resource', value: resource }, ...extra],
  values: values.map((value, i) => ({ timestamp: `2026-11-09T12:0${i}:00Z`, value })),
  unit: 'x',
});

function fakeFetch(bodies: Record<string, unknown>, fail: string[] = []) {
  return vi.fn(async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname.split('/metrics/')[1]!;
    if (fail.includes(path)) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify(bodies[path] ?? []), { status: 200 });
  });
}

const now = () => new Date('2026-11-09T12:05:00Z');

describe('RenderPlatformMetricsSource', () => {
  it('lê os 4 endpoints com Bearer, recursos e janela; % = último uso / limite', async () => {
    const fetchFn = fakeFetch({
      cpu: [series('srv-1', [0.2, 0.4])],
      'cpu-limit': [series('srv-1', [0.5])],
      memory: [series('srv-1', [400, 410])],
      'memory-limit': [series('srv-1', [512])],
    });
    const src = new RenderPlatformMetricsSource({ apiKey: 'k', resourceIds: ['srv-1', 'dpg-1'], fetchFn, now });
    const out = await src.read();
    expect(fetchFn).toHaveBeenCalledTimes(4);
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://api.render.com/v1/metrics/cpu');
    expect(u.searchParams.get('resource')).toBe('srv-1,dpg-1');
    expect(u.searchParams.get('resolutionSeconds')).toBe('60');
    expect(u.searchParams.get('endTime')).toBe('2026-11-09T12:05:00.000Z');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(out).toContainEqual(expect.objectContaining({ resource: 'srv-1', metric: 'cpu_pct', value: 80 }));
    expect(out).toContainEqual(expect.objectContaining({ resource: 'srv-1', metric: 'memory_pct', value: 80.078 }));
    expect(out).toContainEqual(expect.objectContaining({ metric: 'memory', value: 410, meta: { unit: 'x' } }));
  });

  it('endpoint falho só some da amostra; todos falhando lança', async () => {
    const fetchFn = fakeFetch({ cpu: [series('srv-1', [0.2])], memory: [series('srv-1', [100])] }, ['cpu-limit', 'memory-limit']);
    const out = await new RenderPlatformMetricsSource({ apiKey: 'k', resourceIds: ['srv-1'], fetchFn, now }).read();
    expect(out.map((r) => r.metric).sort()).toEqual(['cpu', 'memory']);
    const all = fakeFetch({}, ['cpu', 'cpu-limit', 'memory', 'memory-limit']);
    await expect(new RenderPlatformMetricsSource({ apiKey: 'k', resourceIds: ['srv-1'], fetchFn: all, now }).read()).rejects.toThrow();
  });

  it('série por instância usa o limite do recurso; sem rótulo de recurso é ignorada', () => {
    const pts = lastPoints([series('srv-1', [1], [{ field: 'instance', value: 'srv-1-a' }]), { values: [{ value: 1 }] }, 'x']);
    expect(pts).toEqual([{ resource: 'srv-1', instance: 'srv-1-a', value: 1, unit: 'x' }]);
    expect(lastPoints(null)).toEqual([]);
  });

  it('abort externo (shutdown) cancela a chamada', async () => {
    const ac = new AbortController();
    const fetchFn = vi.fn((_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const p = new RenderPlatformMetricsSource({ apiKey: 'k', resourceIds: ['srv-1'], fetchFn: fetchFn as unknown as typeof fetch, now }).read(ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow();
  });
});
