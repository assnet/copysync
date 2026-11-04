import { describe, expect, it } from 'vitest';
import { normalizeInternationalPhone } from './normalizeInternationalPhone';

describe('normalizeInternationalPhone', () => {
  it('aceita E.164 com ou sem +', () => {
    expect(normalizeInternationalPhone('+55 11 98765-4321')).toBe('5511987654321');
    expect(normalizeInternationalPhone('5511987654321')).toBe('5511987654321');
    expect(normalizeInternationalPhone('+1 (415) 555-0100')).toBe('14155550100');
  });
  it('DDD + número vira brasileiro', () => {
    expect(normalizeInternationalPhone('(11) 98765-4321')).toBe('5511987654321');
  });
  it('rejeita curto, longo, zero à esquerda e vazio', () => {
    expect(normalizeInternationalPhone('1234567')).toBeNull();
    expect(normalizeInternationalPhone('1234567890123456')).toBeNull();
    expect(normalizeInternationalPhone('+0123456789')).toBeNull();
    expect(normalizeInternationalPhone('   ')).toBeNull();
    expect(normalizeInternationalPhone(null)).toBeNull();
  });
});
