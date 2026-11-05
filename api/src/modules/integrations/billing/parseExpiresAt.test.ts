import { describe, expect, it } from 'vitest';
import { parseExpiresAt } from './parseExpiresAt';

describe('parseExpiresAt', () => {
  it('null explícito é válido e limpa', () => {
    expect(parseExpiresAt(null)).toEqual({ valid: true, value: null });
  });

  it('ISO válido vira Date', () => {
    expect(parseExpiresAt('2026-12-04T12:00:00-03:00')).toEqual({ valid: true, value: new Date('2026-12-04T15:00:00.000Z') });
  });

  it.each(['abc', '', '   ', 123, 0, true, {}, [], undefined])('%j é malformado', (raw) => {
    expect(parseExpiresAt(raw)).toEqual({ valid: false });
  });
});
