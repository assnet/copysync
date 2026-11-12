import { describe, expect, it } from 'vitest';
import { parseSalesBucket } from './parseSalesBucket';

describe('parseSalesBucket', () => {
  it.each([
    ['1000+', 1000],
    ['50+', 50],
    ['300+', 300],
    ['1,2mil+', 1200],
    ['1.2k+', 1200],
    ['10mil+', 10000],
    ['1,5 mil+', 1500],
    ['2m+', 2_000_000],
    ['1.000+', 1000],
    ['12.345', 12345],
    ['7', 7],
    [' 80+ ', 80],
  ])('%s → %i', (raw, n) => expect(parseSalesBucket(raw)).toBe(n));

  it.each([null, undefined, '', '   ', 'muito', '-5', '+', {}, NaN, -3])('%s → 0', (raw) =>
    expect(parseSalesBucket(raw)).toBe(0),
  );

  it('número cru → piso', () => expect(parseSalesBucket(41.9)).toBe(41));
});
