import { describe, it, expect } from 'vitest';
import { maskIdentifier } from './maskIdentifier';

describe('maskIdentifier', () => {
  it('mostra só os 4 últimos caracteres', () => {
    expect(maskIdentifier('5577981353128')).toBe('••••3128');
    expect(maskIdentifier('minhaloja-20')).toBe('••••a-20');
  });

  it('identificador curto vira máscara inteira, sem revelar nada', () => {
    expect(maskIdentifier('1234')).toBe('••••');
    expect(maskIdentifier('ab')).toBe('••••');
  });

  it('ignora espaços nas pontas', () => {
    expect(maskIdentifier('  123456  ')).toBe('••••3456');
  });
});
