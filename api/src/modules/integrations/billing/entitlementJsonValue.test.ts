import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { entitlementJsonValue } from './entitlementJsonValue';

describe('entitlementJsonValue', () => {
  it('null (ilimitado) vira JSON null, nunca a string "false"', () => {
    expect(entitlementJsonValue(null)).toBe(Prisma.JsonNull);
  });
  it('mantém número, booleano e string legada', () => {
    expect(entitlementJsonValue(20)).toBe(20);
    expect(entitlementJsonValue(false)).toBe(false);
    expect(entitlementJsonValue('2')).toBe('2');
  });
});
