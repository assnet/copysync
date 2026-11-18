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

  it('P2/P3: telas, adoção, recorrência e retenção concordam com 1', () => {
    expect(S.screens.barValue('1', '1')).toBe('1 conta · 1 dia-conta');
    expect(S.screens.barValue('2', '3')).toBe('2 contas · 3 dias-conta');
    expect(S.retention.retainedOf('1', '1')).toBe('1 de 1 conta do período anterior voltou');
    expect(S.retention.retainedOf('2', '3')).toBe('2 de 3 contas do período anterior voltaram');
    expect(S.retention.recurringOf('1', '1', 3)).toBe('1 de 1 conta usou em 3 dias ou mais');
    expect(S.retention.recurringOf('2', '4', 2)).toBe('2 de 4 contas usaram em 2 dias ou mais');
    expect(S.retention.adoptionOf('1', '1')).toBe('1 de 1 conta com direito');
    expect(S.retention.usedWithoutEligibility('1')).toBe('+1 usou sem direito');
    expect(S.retention.usedWithoutEligibility('2')).toBe('+2 usaram sem direito');
  });
});

describe('motivos de cobertura', () => {
  it('DROPPED (uso descartado por excesso momentâneo) tem texto próprio', () => {
    expect(S.coverageReasons.DROPPED).toMatch(/excesso momentâneo/);
    expect(new Set(Object.values(S.coverageReasons)).size).toBe(Object.keys(S.coverageReasons).length);
  });
});
