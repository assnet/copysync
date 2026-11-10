import { describe, expect, it } from 'vitest';
import {
  alignSeries, cacheHitDomainMin, cacheHitStatus, counterDeltas, counterPeriodTotal, countDomainMax, formatBytes,
  formatDuration, formatPct, isStale, latestValue, newestSampleAt, perMinute, querySharePct, rangeWindow, resourceVisible,
  seriesPoints, shortQueryId, statusFor,
} from './rules';
import type { OpsSeries, OpsSeriesPoint } from './types';

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
  it('taxa por minuto', () => {
    expect(perMinute([null, 30, null], 15)).toEqual([null, 2, null]);
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
