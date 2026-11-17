import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECURRING_DAYS,
  RECURRING_DAYS_OPTIONS,
  type FeatureRetentionInput,
  type RetentionRow,
  activeDaysByTenant,
  featureRetentionStats,
} from './featureUsageRetention';

const row = (day: string, tenantId: string, activeDays = 1): RetentionRow => ({ day, tenantId, activeDays });

const input = (over: Partial<FeatureRetentionInput> = {}): FeatureRetentionInput => ({
  current: [],
  previous: [],
  eligible: new Set(),
  recurringDays: 3,
  hasPreviousBase: true,
  ...over,
});

// t1: 5 dias, t2: 3 dias, t3: 2 dias, t4: 1 dia
const CURRENT = [
  ...['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d) => row(d, 't1')),
  ...['2026-11-01', '2026-11-08', '2026-11-09'].map((d) => row(d, 't2')),
  row('2026-11-02', 't3'),
  row('2026-11-03', 't3'),
  row('2026-11-10', 't4'),
];

describe('adoção do recurso', () => {
  it('0 contas com direito → adoção null', () => {
    const out = featureRetentionStats(input({ current: CURRENT, eligible: new Set() }));
    expect(out.eligibleTenants).toBe(0);
    expect(out.adoption).toBeNull();
  });

  it('sem leitura de direito → contas com direito e adoção null', () => {
    const out = featureRetentionStats(input({ current: CURRENT, eligible: null }));
    expect(out.eligibleTenants).toBeNull();
    expect(out.adoption).toBeNull();
    expect(out.usedWithoutEligibility).toBe(0);
  });

  it('contas que usaram ÷ contas com direito', () => {
    const out = featureRetentionStats(input({ current: CURRENT, eligible: new Set(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']) }));
    expect(out.eligibleTenants).toBe(8);
    expect(out.adoption).toBe(0.5);
    expect(out.usedWithoutEligibility).toBe(0);
  });

  it('conta que usou sem ter direito hoje conta no numerador, é sinalizada e a adoção para em 100%', () => {
    const out = featureRetentionStats(input({ current: CURRENT, eligible: new Set(['t1', 't2']) }));
    expect(out.usedWithoutEligibility).toBe(2);
    expect(out.adoption).toBe(1);
    const partial = featureRetentionStats(input({ current: [row('2026-11-01', 't9')], eligible: new Set(['t1', 't2']) }));
    expect(partial.usedWithoutEligibility).toBe(1);
    expect(partial.adoption).toBe(0.5);
  });

  it('arredonda em 4 casas', () => {
    const out = featureRetentionStats(input({ current: [row('2026-11-01', 't1')], eligible: new Set(['t1', 't2', 't3']) }));
    expect(out.adoption).toBe(0.3333);
  });
});

describe('recorrência do recurso', () => {
  it('opções 2, 3 e 5 com padrão 3', () => {
    expect(RECURRING_DAYS_OPTIONS).toEqual([2, 3, 5]);
    expect(DEFAULT_RECURRING_DAYS).toBe(3);
  });

  it.each([
    [2, 3],
    [3, 2],
    [5, 1],
  ] as const)('N = %i → %i contas', (n, expected) => {
    expect(featureRetentionStats(input({ current: CURRENT, recurringDays: n })).recurringTenants).toBe(expected);
  });

  it('tipos diferentes no mesmo dia não somam dia', () => {
    const rows = [row('2026-11-01', 't1'), row('2026-11-01', 't1'), row('2026-11-02', 't1')];
    expect(activeDaysByTenant(rows).get('t1')).toBe(2);
    expect(featureRetentionStats(input({ current: rows, recurringDays: 3 })).recurringTenants).toBe(0);
  });

  it('linhas por dia e as mesmas linhas agrupadas por semana dão a mesma recorrência', () => {
    // Semanas que começam na segunda: 2026-10-26 e 2026-11-02
    const weekly = [row('2026-10-26', 't1', 1), row('2026-11-02', 't1', 4), row('2026-10-26', 't2', 1), row('2026-11-02', 't2', 1), row('2026-11-09', 't2', 1), row('2026-11-02', 't3', 2), row('2026-11-09', 't4', 1)];
    for (const n of RECURRING_DAYS_OPTIONS) {
      expect(featureRetentionStats(input({ current: weekly, recurringDays: n })).recurringTenants).toBe(
        featureRetentionStats(input({ current: CURRENT, recurringDays: n })).recurringTenants,
      );
    }
  });
});

describe('retenção do recurso', () => {
  it('conta que usou no anterior e no atual', () => {
    const previous = [row('2026-10-01', 't1'), row('2026-10-02', 't3'), row('2026-10-03', 't9')];
    expect(featureRetentionStats(input({ current: CURRENT, previous })).retainedTenants).toBe(2);
  });

  it('sem período anterior completo → null', () => {
    const previous = [row('2026-10-01', 't1')];
    expect(featureRetentionStats(input({ current: CURRENT, previous, hasPreviousBase: false })).retainedTenants).toBeNull();
  });

  it('sem uso no anterior → 0 (não null)', () => {
    expect(featureRetentionStats(input({ current: CURRENT })).retainedTenants).toBe(0);
  });
});
