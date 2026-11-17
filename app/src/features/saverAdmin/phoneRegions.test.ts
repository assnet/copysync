import { describe, expect, it } from 'vitest';
import { toPlatformFilterParams } from '@/services/saverAdmin.service';
import { BRAZIL_DDDS, COMMON_DDIS, ddiOf, isCountryCode, splitPhone } from './phoneRegions';
import { formatCount, formatShare } from './format';
import { EMPTY_PLATFORM_FILTERS } from './types';

describe('phoneRegions', () => {
  it('DDI de 1, 2 e 3 dígitos; código de país só inteiro', () => {
    expect(ddiOf('5511987650001')).toBe('55');
    expect(ddiOf('14155550100')).toBe('1');
    expect(ddiOf('351912345678')).toBe('351');
    expect(['1', '55', '351'].every(isCountryCode)).toBe(true);
    expect(['5', '551', '12', '', 'x'].some(isCountryCode)).toBe(false);
  });

  it('Brasil primeiro na lista; 67 DDDs em ordem', () => {
    expect(COMMON_DDIS[0]).toBe('55');
    expect(COMMON_DDIS.every(isCountryCode)).toBe(true);
    expect(BRAZIL_DDDS).toHaveLength(67);
    expect(BRAZIL_DDDS[0]).toBe('11');
  });

  it('separa DDI, DDD e número local', () => {
    expect(splitPhone('5511987650001')).toEqual({ ddi: '55', ddd: '11', local: '98765-0001' });
    expect(splitPhone('552133334444')).toEqual({ ddi: '55', ddd: '21', local: '3333-4444' });
    expect(splitPhone('5520999990000')).toEqual({ ddi: '55', ddd: null, local: '20999990000' });
    expect(splitPhone('351912345678')).toEqual({ ddi: '351', ddd: null, local: '912345678' });
    expect(splitPhone('12')).toEqual({ ddi: '1', ddd: null, local: '2' });
  });
});

describe('formatação de contagem', () => {
  it('milhar e porcentagem em pt-BR', () => {
    expect(formatCount(1284310)).toBe('1.284.310');
    expect(formatShare(1, 3)).toBe('33,3%');
    expect(formatShare(5, 0)).toBeNull();
    expect(formatShare(23, 127820)).toBe('<0,1%');
    expect(formatShare(0, 10)).toBe('0%');
  });
});

describe('toPlatformFilterParams', () => {
  it('manda DDI e DDD só quando preenchidos; DDD só com o Brasil', () => {
    expect(toPlatformFilterParams(EMPTY_PLATFORM_FILTERS)).toEqual({});
    expect(toPlatformFilterParams({ ...EMPTY_PLATFORM_FILTERS, ddi: '55', ddd: '11' })).toEqual({ ddi: '55', ddd: '11' });
    expect(toPlatformFilterParams({ ...EMPTY_PLATFORM_FILTERS, ddi: '351', ddd: '11' })).toEqual({ ddi: '351' });
    expect(toPlatformFilterParams({ ...EMPTY_PLATFORM_FILTERS, ddd: '11' })).toEqual({});
    expect(toPlatformFilterParams({ ...EMPTY_PLATFORM_FILTERS, ddi: '55' })).not.toHaveProperty('limit');
  });
});
