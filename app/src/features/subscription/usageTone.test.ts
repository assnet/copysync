import { describe, expect, it } from 'vitest';
import { usageTone, usageToneFor } from './usageTone';

describe('usageTone', () => {
  it('ilimitado é default', () => expect(usageTone(999, null)).toBe('default'));
  it('100% ou acima é error', () => {
    expect(usageTone(10, 10)).toBe('error');
    expect(usageTone(12, 10)).toBe('error');
    expect(usageTone(0, 0)).toBe('error');
  });
  it('≥ 80% é warning', () => {
    expect(usageTone(8, 10)).toBe('warning');
    expect(usageTone(9, 10)).toBe('warning');
    expect(usageTone(1, 2)).toBe('warning');
  });
  it('abaixo de 80% é default', () => {
    expect(usageTone(7, 10)).toBe('default');
    expect(usageTone(0, 5)).toBe('default');
    expect(usageTone(0, 1)).toBe('default');
  });
});

describe('usageToneFor', () => {
  it('etiquetas do ML no limite ficam neutras', () => {
    expect(usageToneFor('mercado_livre_affiliate_tags', 1, 1)).toBe('default');
    expect(usageToneFor('mercado_livre_affiliate_tags', 9, 10)).toBe('default');
  });
  it('etiquetas do ML acima do limite são error', () => {
    expect(usageToneFor('mercado_livre_affiliate_tags', 3, 2)).toBe('error');
  });
  it('chave sem política segue usageTone', () => {
    expect(usageToneFor('outra_chave', 10, 10)).toBe('error');
    expect(usageToneFor('outra_chave', 8, 10)).toBe('warning');
  });
});
