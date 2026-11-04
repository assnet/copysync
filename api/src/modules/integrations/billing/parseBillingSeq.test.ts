import { describe, expect, it } from 'vitest';
import { parseBillingSeq } from './parseBillingSeq';

describe('parseBillingSeq', () => {
  it('número inteiro seguro vira bigint', () => {
    expect(parseBillingSeq(0)).toBe(0n);
    expect(parseBillingSeq(7)).toBe(7n);
    expect(parseBillingSeq(2_147_483_648)).toBe(2_147_483_648n);
    expect(parseBillingSeq(Number.MAX_SAFE_INTEGER)).toBe(9_007_199_254_740_991n);
  });

  it('string numérica preserva precisão até o teto do BIGINT', () => {
    expect(parseBillingSeq('42')).toBe(42n);
    expect(parseBillingSeq('9007199254740993')).toBe(9_007_199_254_740_993n);
    expect(parseBillingSeq('9223372036854775807')).toBe(9_223_372_036_854_775_807n);
  });

  it('rejeita fora do contrato', () => {
    for (const v of [
      -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '9223372036854775808', '-1', '1.0', ' 1', '', '1e3',
      '0x10', '12345678901234567890', null, undefined, true, {}, [1], 1n,
    ]) {
      expect(parseBillingSeq(v), String(v)).toBeNull();
    }
  });
});
