import { describe, expect, it } from 'vitest';
import { UsageMetricsRangeInvalidError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import {
  USAGE_TIME_ZONE,
  addDays,
  bucketOf,
  dataFromOf,
  dayInZone,
  resolveUsagePeriod,
  startOfDayInstant,
  usageBuckets,
} from './featureUsagePeriod';

// 2026-11-17 23:50 em Brasília (UTC−3) = 2026-11-18 02:50 UTC.
const LATE_NIGHT = new Date('2026-11-18T02:50:00.000Z');
const NOON = new Date('2026-11-17T15:00:00.000Z');

describe('dia no fuso das métricas de uso', () => {
  it('usa Brasília', () => {
    expect(USAGE_TIME_ZONE).toBe('America/Sao_Paulo');
  });

  it('põe evento às 02:30 UTC no dia anterior', () => {
    expect(dayInZone(new Date('2026-11-17T02:30:00.000Z'))).toBe('2026-11-16');
    expect(dayInZone(new Date('2026-11-17T03:00:00.000Z'))).toBe('2026-11-17');
  });

  it('considera hoje às 23:50 de Brasília ainda o mesmo dia', () => {
    expect(dayInZone(LATE_NIGHT)).toBe('2026-11-17');
  });

  it('converte o dia na meia-noite de Brasília em UTC', () => {
    expect(startOfDayInstant('2026-11-17').toISOString()).toBe('2026-11-17T03:00:00.000Z');
  });
});

describe('resolveUsagePeriod', () => {
  it('gera o intervalo UTC e o período anterior colado, de mesma duração', () => {
    const p = resolveUsagePeriod({ from: '2026-10-19', to: '2026-11-17', granularity: 'day', now: NOON, maxDays: 90 });
    expect(p.days).toBe(30);
    expect(p.fromInstant.toISOString()).toBe('2026-10-19T03:00:00.000Z');
    expect(p.toExclusive.toISOString()).toBe('2026-11-18T03:00:00.000Z');
    expect(p.previousFrom).toBe('2026-09-19');
    expect(p.previousTo).toBe('2026-10-18');
    expect(p.previousFromInstant.toISOString()).toBe('2026-09-19T03:00:00.000Z');
    expect(p.buckets).toHaveLength(30);
    expect(p.buckets[0]).toEqual({ key: '2026-10-19', from: '2026-10-19', to: '2026-10-19' });
  });

  it('aceita hoje como fim mesmo às 23:50 de Brasília', () => {
    const p = resolveUsagePeriod({ from: '2026-11-17', to: '2026-11-17', granularity: 'day', now: LATE_NIGHT, maxDays: 90 });
    expect(p.days).toBe(1);
    expect(p.previousFrom).toBe('2026-11-16');
    expect(p.previousTo).toBe('2026-11-16');
  });

  it('recusa 91 dias com teto de 90 e informa o teto', () => {
    const from = addDays('2026-11-17', -90);
    try {
      resolveUsagePeriod({ from, to: '2026-11-17', granularity: 'week', now: NOON, maxDays: 90 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UsageMetricsRangeInvalidError);
      expect((e as UsageMetricsRangeInvalidError).meta).toMatchObject({ maxDays: 90 });
    }
    expect(resolveUsagePeriod({ from: addDays(from, 1), to: '2026-11-17', granularity: 'week', now: NOON, maxDays: 90 }).days).toBe(90);
  });

  it('recusa início depois do fim, data futura e data inválida', () => {
    const base = { granularity: 'day' as const, now: NOON, maxDays: 90 };
    expect(() => resolveUsagePeriod({ ...base, from: '2026-11-10', to: '2026-11-01' })).toThrow(UsageMetricsRangeInvalidError);
    expect(() => resolveUsagePeriod({ ...base, from: '2026-11-10', to: '2026-11-18' })).toThrow(UsageMetricsRangeInvalidError);
    expect(() => resolveUsagePeriod({ ...base, from: '2026-02-30', to: '2026-03-01' })).toThrow(UsageMetricsRangeInvalidError);
    expect(() => resolveUsagePeriod({ ...base, from: '17/11/2026', to: '2026-11-17' })).toThrow(UsageMetricsRangeInvalidError);
  });

  it('com 23:50 de Brasília, amanhã ainda é futuro', () => {
    expect(() =>
      resolveUsagePeriod({ from: '2026-11-17', to: '2026-11-18', granularity: 'day', now: LATE_NIGHT, maxDays: 90 }),
    ).toThrow(UsageMetricsRangeInvalidError);
  });
});

describe('buckets', () => {
  function assertContiguous(buckets: { from: string; to: string }[], from: string, to: string) {
    expect(buckets[0]!.from).toBe(from);
    expect(buckets.at(-1)!.to).toBe(to);
    for (let i = 1; i < buckets.length; i += 1) expect(buckets[i]!.from).toBe(addDays(buckets[i - 1]!.to, 1));
  }

  it('semana começa na segunda e corta as pontas ao período', () => {
    // 2026-08-18 é terça; 2026-11-15 é domingo.
    const b = usageBuckets('2026-08-18', '2026-11-15', 'week');
    expect(b).toHaveLength(13);
    expect(b[0]).toEqual({ key: '2026-08-17', from: '2026-08-18', to: '2026-08-23' });
    expect(b.at(-1)).toEqual({ key: '2026-11-09', from: '2026-11-09', to: '2026-11-15' });
    assertContiguous(b, '2026-08-18', '2026-11-15');
  });

  it('semana parcial no fim', () => {
    const b = usageBuckets('2026-11-02', '2026-11-17', 'week');
    expect(b.map((x) => x.key)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
    expect(b.at(-1)).toEqual({ key: '2026-11-16', from: '2026-11-16', to: '2026-11-17' });
  });

  it('mês sem buraco, atravessando o ano, com parciais nas pontas', () => {
    const b = usageBuckets('2026-11-20', '2027-02-10', 'month');
    expect(b).toEqual([
      { key: '2026-11-01', from: '2026-11-20', to: '2026-11-30' },
      { key: '2026-12-01', from: '2026-12-01', to: '2026-12-31' },
      { key: '2027-01-01', from: '2027-01-01', to: '2027-01-31' },
      { key: '2027-02-01', from: '2027-02-01', to: '2027-02-10' },
    ]);
  });

  it('bucketOf leva cada dia à chave do seu bucket', () => {
    expect(bucketOf('2026-11-15', 'week')).toBe('2026-11-09'); // domingo → segunda anterior
    expect(bucketOf('2026-11-16', 'week')).toBe('2026-11-16'); // segunda
    expect(bucketOf('2026-11-17', 'month')).toBe('2026-11-01');
    expect(bucketOf('2026-11-17', 'day')).toBe('2026-11-17');
  });
});

describe('dataFromOf', () => {
  it('devolve null quando o recurso não tem dado', () => {
    expect(dataFromOf(null, 30, NOON)).toBeNull();
    expect(dataFromOf(null, undefined, NOON)).toBeNull();
  });

  it('sem retenção é o primeiro dado', () => {
    expect(dataFromOf('2026-03-02', undefined, NOON)).toBe('2026-03-02');
  });

  it('com retenção é o maior entre o primeiro dado e hoje menos a retenção', () => {
    expect(dataFromOf('2026-10-08', 30, NOON)).toBe('2026-10-18');
    expect(dataFromOf('2026-11-01', 30, NOON)).toBe('2026-11-01');
  });
});
