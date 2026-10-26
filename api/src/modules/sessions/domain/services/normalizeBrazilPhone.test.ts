import { describe, it, expect } from 'vitest';
import { normalizeBrazilPhone, hasPhoneMismatch } from './normalizeBrazilPhone';

describe('normalizeBrazilPhone', () => {
  it.each([
    ['11987654321', '5511987654321'],
    ['1133334444', '551133334444'],
    ['(11) 98765-4321', '5511987654321'],
    ['+55 11 98765-4321', '5511987654321'],
    ['551133334444', '551133334444'],
  ])('normaliza %s → %s', (raw, expected) => {
    expect(normalizeBrazilPhone(raw)).toBe(expected);
  });

  it.each(['', '123', '987654321', '441133334444', '5511987654321000', 'abc'])(
    'rejeita %s',
    (raw) => {
      expect(normalizeBrazilPhone(raw)).toBeNull();
    },
  );

  it('rejeita valor ausente', () => {
    expect(normalizeBrazilPhone(null)).toBeNull();
    expect(normalizeBrazilPhone(undefined)).toBeNull();
  });
});

describe('hasPhoneMismatch', () => {
  it('false quando falta um dos números', () => {
    expect(hasPhoneMismatch(null, '5511987654321')).toBe(false);
    expect(hasPhoneMismatch('5511987654321', null)).toBe(false);
  });

  it('false para o mesmo número, inclusive com sufixo de aparelho do JID', () => {
    expect(hasPhoneMismatch('5511987654321', '5511987654321')).toBe(false);
    expect(hasPhoneMismatch('5511987654321:12@s.whatsapp.net', '5511987654321')).toBe(false);
  });

  it('false quando o JID vem sem o nono dígito', () => {
    expect(hasPhoneMismatch('558187654321', '5581987654321')).toBe(false);
  });

  it('true para números diferentes', () => {
    expect(hasPhoneMismatch('5511912345678', '5511987654321')).toBe(true);
    expect(hasPhoneMismatch('5521987654321', '5511987654321')).toBe(true);
  });
});
