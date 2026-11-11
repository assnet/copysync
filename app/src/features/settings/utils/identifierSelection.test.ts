import { describe, expect, it } from 'vitest';
import { choosePrimary, isFull, sanitizeSelection, toggleLinked, usedOf } from './identifierSelection';

describe('identifierSelection', () => {
  it('sanitize descarta fora da conta, repetidas e o que passa do limite', () => {
    expect(sanitizeSelection({ primary: 'x', linked: ['a', 'a', 'b', 'c'] }, ['a', 'b', 'c'], 2))
      .toEqual({ primary: null, linked: ['a'] });
    expect(sanitizeSelection({ primary: 'a', linked: ['a', 'b'] }, ['a', 'b'], 10)).toEqual({ primary: 'a', linked: ['b'] });
  });

  it('nova principal sai das vinculadas; a antiga vira vinculada se couber', () => {
    expect(choosePrimary({ primary: 'a', linked: ['b'] }, 'b', 2)).toEqual({ primary: 'b', linked: ['a'] });
    expect(choosePrimary({ primary: 'a', linked: [] }, 'b', 1)).toEqual({ primary: 'b', linked: [] });
  });

  it('vincular respeita o limite e ignora a principal', () => {
    const sel = { primary: 'a', linked: [] as string[] };
    expect(toggleLinked(sel, 'b', 2)).toEqual({ primary: 'a', linked: ['b'] });
    expect(toggleLinked({ primary: 'a', linked: ['b'] }, 'c', 2)).toEqual({ primary: 'a', linked: ['b'] });
    expect(toggleLinked({ primary: 'a', linked: ['b'] }, 'b', 2)).toEqual({ primary: 'a', linked: [] });
    expect(toggleLinked(sel, 'a', 2)).toBe(sel);
  });

  it('uso e lotação contam a principal', () => {
    expect(usedOf({ primary: 'a', linked: ['b'] })).toBe(2);
    expect(isFull({ primary: 'a', linked: ['b'] }, 2)).toBe(true);
    expect(isFull({ primary: 'a', linked: [] }, 2)).toBe(false);
    expect(isFull({ primary: null, linked: [] }, 1)).toBe(true);
  });
});
