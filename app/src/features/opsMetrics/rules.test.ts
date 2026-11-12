import { describe, expect, it } from 'vitest';
import {
  alignSeries, cacheHitDomainMin, cacheHitStatus, counterDeltas, counterPeriodTotal, countDomainMax, formatBytes,
  formatDuration, formatPct, isStale, latestValue, newestSampleAt, counterRatePerMinute, parseUsageFilters, querySharePct, rangeWindow, currentValues, resourceCount, resourceVisible,
  seriesPoints, shortQueryId, statusFor, instanceShortName, seriesByInstance, parseWorkerChartView,
  workerInstancesSection,
} from './rules';
import type { OpsSeries, OpsSeriesPoint, OpsWorkerInstance } from './types';

const pt = (at: string, avg: number, min = avg, max = avg): OpsSeriesPoint => ({ at, avg, min, max });

describe('statusFor', () => {
  it('ok abaixo de 87,5% do limiar, atenção até o limiar, crítico a partir dele', () => {
    expect(statusFor(69.9, 80)).toBe('ok');
    expect(statusFor(70, 80)).toBe('warning');
    expect(statusFor(79.9, 80)).toBe('warning');
    expect(statusFor(80, 80)).toBe('critical');
    expect(statusFor(2, 3)).toBe('ok');
    expect(statusFor(3, 3)).toBe('critical');
    expect(statusFor(200, 200)).toBe('critical');
  });
  it('sem valor = sem dados', () => {
    expect(statusFor(null, 80)).toBe('noData');
    expect(statusFor(undefined, 80)).toBe('noData');
    expect(statusFor(Number.NaN, 80)).toBe('noData');
  });
  it('cache hit: menor é pior', () => {
    expect(cacheHitStatus(99.6)).toBe('ok');
    expect(cacheHitStatus(97)).toBe('warning');
    expect(cacheHitStatus(94.9)).toBe('critical');
    expect(cacheHitStatus(null)).toBe('noData');
  });
});

describe('counterDeltas', () => {
  it('delta pelo máximo do balde; 1º balde vazio', () => {
    expect(counterDeltas([pt('a', 10, 5, 10), pt('b', 0, 10, 25), pt('c', 0, 25, 40)])).toEqual([null, 15, 15]);
  });
  it('reinício (delta negativo) vira balde vazio e recomeça do novo acumulado', () => {
    expect(counterDeltas([pt('a', 0, 0, 100), pt('b', 0, 0, 4), pt('c', 0, 4, 10)])).toEqual([null, null, 6]);
  });
  it('buraco não quebra a sequência', () => {
    expect(counterDeltas([pt('a', 0, 0, 10), null, pt('c', 0, 10, 30)])).toEqual([null, null, 20]);
  });
  it('total do período soma deltas e o que mudou dentro do 1º balde', () => {
    expect(counterPeriodTotal([pt('a', 0, 2, 10), pt('b', 0, 10, 12), pt('c', 0, 0, 3)])).toBe(10);
    expect(counterPeriodTotal([])).toBeNull();
  });
  it('taxa por minuto pelo intervalo real', () => {
    const T = 15 * 60_000;
    expect(counterRatePerMinute([pt('a', 0, 0, 0), pt('b', 0, 0, 30)], [0, T])).toEqual([null, 2]);
  });
  it('buraco de 3 baldes divide pelo intervalo real (sem pico falso)', () => {
    const T = 15 * 60_000;
    // 4 baldes de 15 min (60 min) com 3 vazios no meio: 120 commits → 2/min, não 8/min.
    const rows = [pt('a', 0, 0, 100), null, null, null, pt('e', 0, 100, 220)];
    expect(counterRatePerMinute(rows, [0, T, 2 * T, 3 * T, 4 * T])).toEqual([null, null, null, null, 2]);
  });
  it('reinício (delta negativo) = 0', () => {
    const T = 15 * 60_000;
    expect(counterRatePerMinute([pt('a', 0, 0, 100), pt('b', 0, 0, 4), pt('c', 0, 4, 34)], [0, T, 2 * T]))
      .toEqual([null, 0, 2]);
  });
});

describe('parseUsageFilters', () => {
  it('valores válidos passam; inválidos caem no padrão campo a campo', () => {
    expect(parseUsageFilters({ range: '7d', resource: 'api', autoRefresh: false }))
      .toEqual({ range: '7d', resource: 'api', autoRefresh: false });
    expect(parseUsageFilters({ range: '2y', resource: 'x', autoRefresh: 'sim' }))
      .toEqual({ range: '24h', resource: 'all', autoRefresh: true });
    expect(parseUsageFilters({ range: '1h', resource: 'worker_service', autoRefresh: true }).resource).toBe('worker_service');
    expect(parseUsageFilters(null)).toEqual({ range: '24h', resource: 'all', autoRefresh: true });
  });
});

describe('alignSeries', () => {
  it('une instantes e interrompe a linha quando faltam mais de 2 baldes', () => {
    const a = [pt('2026-01-01T00:00:00Z', 1), pt('2026-01-01T00:05:00Z', 2), pt('2026-01-01T00:30:00Z', 3)];
    const b = [pt('2026-01-01T00:05:00Z', 9)];
    const r = alignSeries([a, b], 5);
    expect(r.times.length).toBe(4); // 00:00, 00:05, buraco 00:10, 00:30
    expect(r.rows[0].map((p) => p?.avg ?? null)).toEqual([1, 2, null, 3]);
    expect(r.rows[1].map((p) => p?.avg ?? null)).toEqual([null, 9, null, null]);
  });
  it('falta de até 2 baldes não cria buraco', () => {
    const a = [pt('2026-01-01T00:00:00Z', 1), pt('2026-01-01T00:15:00Z', 2)];
    expect(alignSeries([a], 5).times.length).toBe(2);
  });
});

describe('séries e valores atuais', () => {
  const series: OpsSeries[] = [
    { resource: 'srv-a', kind: 'api', metric: 'cpu_pct', points: [pt('t1', 10, 5, 20)] },
    { resource: 'srv-b', kind: 'api', metric: 'cpu_pct', points: [pt('t1', 30, 1, 40), pt('t2', 5)] },
    { resource: 'dpg-x', kind: 'postgres', metric: 'cpu_pct', points: [pt('t1', 50)] },
  ];
  it('vários recursos do mesmo tipo viram o pior valor por balde', () => {
    expect(seriesPoints(series, 'cpu_pct', 'api')).toEqual([pt('t1', 30, 5, 40), pt('t2', 5)]);
    expect(seriesPoints(series, 'cpu_pct', 'postgres')).toEqual([pt('t1', 50)]);
  });
  it('último valor = pior entre recursos; amostra mais recente', () => {
    const latest = [
      { resource: 'srv-a', kind: 'api' as const, metric: 'memory_pct', value: 40, at: '2026-01-01T00:05:00Z' },
      { resource: 'srv-b', kind: 'api' as const, metric: 'memory_pct', value: 62, at: '2026-01-01T00:10:00Z' },
    ];
    expect(latestValue(latest, 'memory_pct', 'api')?.value).toBe(62);
    expect(latestValue(latest, 'memory_pct', 'postgres')).toBeNull();
    expect(newestSampleAt(latest, [])).toBe('2026-01-01T00:10:00Z');
    expect(newestSampleAt([], series)).toBe('t2');
  });
  it('filtro de recurso só esconde o outro recurso', () => {
    expect(resourceVisible('all', 'api')).toBe(true);
    expect(resourceVisible('api', 'postgres')).toBe(false);
    expect(resourceVisible('postgres', 'postgres')).toBe(true);
    expect(resourceVisible('worker_service', 'worker_service')).toBe(true);
    expect(resourceVisible('worker_service', 'api')).toBe(false);
    expect(resourceVisible('all', 'worker_service')).toBe(true);
  });
});

describe('resourceCount', () => {
  it('conta recursos distintos do tipo com a métrica', () => {
    const v = (resource: string, kind: 'api' | 'worker_service', metric = 'memory_pct') => ({ resource, kind, metric, value: 1, at: '2026-11-12T00:00:00Z' });
    const latest = [v('srv-w-a', 'worker_service'), v('srv-w-b', 'worker_service'), v('srv-w-a', 'worker_service', 'cpu_pct'), v('srv-a', 'api')];
    expect(resourceCount(latest, 'memory_pct', 'worker_service')).toBe(2);
    expect(resourceCount(latest, 'cpu_pct', 'worker_service')).toBe(1);
    expect(resourceCount(latest, 'memory_pct', 'postgres')).toBe(0);
  });

  it('instância trocada por deploy (amostra > 2 min antes da mais nova) fica de fora', () => {
    const v = (resource: string, at: string, value: number) => ({ resource, kind: 'worker_service' as const, metric: 'memory_pct', value, at });
    const latest = [
      v('srv-w-old', '2026-11-12T00:00:00Z', 95), // instância antiga, 10 min antes
      v('srv-w-a', '2026-11-12T00:09:00Z', 40),
      v('srv-w-b', '2026-11-12T00:10:00Z', 50),
    ];
    expect(currentValues(latest, 'memory_pct', 'worker_service').map((x) => x.resource)).toEqual(['srv-w-a', 'srv-w-b']);
    expect(resourceCount(latest, 'memory_pct', 'worker_service')).toBe(2);
    expect(currentValues([], 'memory_pct', 'worker_service')).toEqual([]);
  });
});

describe('janela, staleness e domínios', () => {
  it('janela termina agora', () => {
    const now = Date.parse('2026-01-02T00:00:00Z');
    expect(rangeWindow('24h', now)).toEqual({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' });
  });
  it('amostra com mais de 15 min = parada', () => {
    const now = Date.parse('2026-01-01T01:00:00Z');
    expect(isStale('2026-01-01T00:44:00Z', now)).toBe(true);
    expect(isStale('2026-01-01T00:46:00Z', now)).toBe(false);
    expect(isStale(null, now)).toBe(false);
  });
  it('domínios incluem o limiar e o piso do cache hit', () => {
    expect(countDomainMax([1, 2], 3)).toBe(4);
    expect(countDomainMax([null])).toBe(1);
    expect(cacheHitDomainMin([99.5, 97])).toBe(90);
    expect(cacheHitDomainMin([85.2])).toBe(85);
  });
});

describe('formatação', () => {
  it('percentual pt-BR', () => {
    expect(formatPct(62)).toBe('62%');
    expect(formatPct(99.6)).toBe('99,6%');
    expect(formatPct(null)).toBe('—');
  });
  it('bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3,4 MB');
    expect(formatBytes(null)).toBe('—');
  });
  it('duração', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(12_000)).toBe('12 s');
    expect(formatDuration(252_000)).toBe('4 min 12 s');
    expect(formatDuration(7_500_000)).toBe('2 h 5 min');
  });
  it('participação e id curto', () => {
    const q = (totalMs: number) => ({ queryid: '1', shape: 's', totalMs, meanMs: null, calls: null, at: 'x' });
    expect(querySharePct([q(38), q(62)])).toEqual([38, 62]);
    expect(querySharePct([q(0)])).toEqual([0]);
    expect(shortQueryId('-4721938475610293')).toBe('…75610293');
    expect(shortQueryId('123')).toBe('123');
  });
});

describe('instâncias do worker', () => {
  it('nome curto: sufixo da instância; sem sufixo, o id inteiro', () => {
    expect(instanceShortName('srv-dbqhvkrbc2fs73del670-4lx97')).toBe('4lx97');
    expect(instanceShortName('srv-dbqhvkrbc2fs73del670')).toBe('srv-dbqhvkrbc2fs73del670');
  });
  it('uma série por instância do worker_service, ordenada pelo nome curto', () => {
    const p = [{ at: '2026-11-12T00:00:00.000Z', avg: 1, min: 1, max: 1 }];
    const out = seriesByInstance([
      { resource: 'srv-wk-zz', kind: 'worker_service', metric: 'cpu_pct', points: p },
      { resource: 'srv-wk-aa', kind: 'worker_service', metric: 'cpu_pct', points: p },
      { resource: 'srv-api', kind: 'api', metric: 'cpu_pct', points: p },
      { resource: 'srv-wk-aa', kind: 'worker_service', metric: 'memory_pct', points: p },
    ], 'cpu_pct');
    expect(out.map((x) => x.label)).toEqual(['aa', 'zz']);
  });
  it('visão persistida inválida cai em "pior instância"', () => {
    expect(parseWorkerChartView('instance')).toBe('instance');
    expect(parseWorkerChartView('x')).toBe('worst');
  });
});

describe('workerInstancesSection', () => {
  const inst: OpsWorkerInstance = { instance: 'a1', resource: 'srv-wk-a1', cpuPct: 1, memoryPct: 2, sampledAt: null, heartbeat: null };
  const base = { resource: 'all' as const, loading: false, latestFailed: false, instances: [inst], hasWorkerData: true };
  it('filtro sem o worker some; carregando = skeleton', () => {
    expect(workerInstancesSection({ ...base, resource: 'api' })).toEqual({ kind: 'hidden' });
    expect(workerInstancesSection({ ...base, loading: true })).toEqual({ kind: 'loading' });
  });
  it('com instâncias = tabela', () => {
    expect(workerInstancesSection(base)).toEqual({ kind: 'table', instances: [inst] });
  });
  it('/latest falhou: erro com sinal de worker ou filtro só worker; senão some', () => {
    expect(workerInstancesSection({ ...base, latestFailed: true, instances: null })).toEqual({ kind: 'error' });
    expect(workerInstancesSection({ ...base, latestFailed: true, instances: null, hasWorkerData: false })).toEqual({ kind: 'hidden' });
    expect(workerInstancesSection({ ...base, resource: 'worker_service', latestFailed: true, instances: null, hasWorkerData: false }))
      .toEqual({ kind: 'error' });
  });
  it('sem instância atual: offline com dados do worker, não configurado só no filtro do worker', () => {
    expect(workerInstancesSection({ ...base, instances: [] })).toEqual({ kind: 'empty', reason: 'offline' });
    expect(workerInstancesSection({ ...base, instances: [], hasWorkerData: false })).toEqual({ kind: 'hidden' });
    expect(workerInstancesSection({ ...base, resource: 'worker_service', instances: [], hasWorkerData: false }))
      .toEqual({ kind: 'empty', reason: 'notConfigured' });
  });
});
