import { describe, expect, it } from 'vitest';
import { identifierLimitOf } from './affiliateIdentifierLimit';

describe('identifierLimitOf', () => {
  it('inteiro ≥ 1 vale o próprio valor', () => {
    expect(identifierLimitOf(1)).toBe(1);
    expect(identifierLimitOf(2)).toBe(2);
    expect(identifierLimitOf(10)).toBe(10);
  });

  it('ausente ou null vale 1 (não existe "sem limite")', () => {
    expect(identifierLimitOf(undefined)).toBe(1);
    expect(identifierLimitOf(null)).toBe(1);
  });

  it('inválido vale 1', () => {
    for (const v of [0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(identifierLimitOf(v)).toBe(1);
  });
});
