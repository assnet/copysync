import { describe, expect, it } from 'vitest';
import { featureUsageStrings as S } from './strings';

describe('contagens no singular para 1', () => {
  it('usos, contas, dias e tipos', () => {
    expect(S.comparison.usesDelta('+1')).toBe('+1 uso');
    expect(S.comparison.usesDelta('-3')).toBe('-3 usos');
    expect(S.comparison.tenantsDelta('-1')).toBe('-1 conta');
    expect(S.ranking.barValue('1', '1')).toBe('1 conta · 1 uso');
    expect(S.ranking.barValue('2', '1.234')).toBe('2 contas · 1.234 usos');
    expect(S.plansTab.uses('1')).toBe('1 uso');
    expect(S.plansTab.cellAria('A', 'B', '1', '1', '1')).toBe('A, B: 1 de 1 conta, 1 uso');
    expect(S.plansTab.planTenants('1')).toBe('1 conta');
    expect(S.kpis.topFeature.context('11')).toBe('11 contas');
    expect(S.filters.kindSelected(1)).toBe('1 tipo');
    expect(S.coverage.retentionDays(1)).toBe('A fonte guarda 1 dia.');
    expect(S.periodErrors.tooLong(366)).toBe('Escolha até 366 dias.');
  });
});

describe('motivos de cobertura', () => {
  it('DROPPED (uso descartado por excesso momentâneo) tem texto próprio', () => {
    expect(S.coverageReasons.DROPPED).toMatch(/excesso momentâneo/);
    expect(new Set(Object.values(S.coverageReasons)).size).toBe(Object.keys(S.coverageReasons).length);
  });
});
