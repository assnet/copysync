import { describe, expect, it } from 'vitest';
import { validateHuntDefinition } from './validateHuntDefinition';
import type { OfferHuntDefinition } from '../../hunter/OfferHunt';

const BASE: OfferHuntDefinition = {
  name: 'Maior comissão', sort: 'RECOMMENDED', categoryId: null, commissionBand: null, keyword: null, filters: {},
  aiEnabled: false, topN: 3, repeatAfterDays: 7, deliveryMode: 'REVIEW', intervalMinutes: 60,
  windowStartMinute: 0, windowEndMinute: 1440, weekdaysMask: 127,
};
const field = (patch: Partial<OfferHuntDefinition>) => {
  const r = validateHuntDefinition({ ...BASE, ...patch });
  return r.ok ? null : r.field;
};

describe('validateHuntDefinition', () => {
  it('válida: normaliza nome, palavra vazia e início 1440', () => {
    const r = validateHuntDefinition({ ...BASE, name: '  Caça  ', keyword: '   ', windowStartMinute: 1440, windowEndMinute: 360 });
    expect(r.ok && r.value).toMatchObject({ name: 'Caça', keyword: null, windowStartMinute: 0, windowEndMinute: 360 });
  });

  it.each([
    [{ name: '  ' }, 'name'],
    [{ name: 'a'.repeat(81) }, 'name'],
    [{ sort: 'X' as never }, 'sort'],
    [{ filters: { minCommissionPct: 51 } }, 'filters.minCommissionPct'],
    [{ filters: { minCommissionPct: 10, commissionOperator: 'EQ' as never } }, 'filters.commissionOperator'],
    [{ categoryId: 'a b' }, 'categoryId'],
    [{ keyword: 'x'.repeat(61) }, 'keyword'],
    [{ keyword: 'a\u0007b' }, 'keyword'],
    [{ topN: 0 }, 'topN'],
    [{ topN: 6 }, 'topN'],
    [{ repeatAfterDays: 31 }, 'repeatAfterDays'],
    [{ intervalMinutes: 29 }, 'intervalMinutes'],
    [{ intervalMinutes: 1441 }, 'intervalMinutes'],
    [{ windowStartMinute: 600, windowEndMinute: 600 }, 'windowEndMinute'],
    [{ windowStartMinute: 1440, windowEndMinute: 0 }, 'windowEndMinute'],
    [{ weekdaysMask: 0 }, 'weekdaysMask'],
    [{ deliveryMode: 'NOW' as never }, 'deliveryMode'],
    [{ filters: { minRating: 6 } }, 'filters.minRating'],
    [{ filters: { minSales: 1.5 } }, 'filters.minSales'],
    [{ filters: { minPriceCents: 500, maxPriceCents: 100 } }, 'filters.maxPriceCents'],
    [{ filters: { onlyWithExtra: 'sim' as never } }, 'filters.onlyWithExtra'],
  ])('%j → campo %s', (patch, expected) => {
    expect(field(patch)).toBe(expected);
  });

  it('filtros: só os conhecidos, null some', () => {
    const r = validateHuntDefinition({ ...BASE, filters: { minCommissionPct: 12.5, minSales: null, onlyWithExtra: true, extra: 1 } as never });
    expect(r.ok && r.value.filters).toEqual({ minCommissionPct: 12.5, commissionOperator: 'GTE', onlyWithExtra: true });
  });

  it('comissão: operador só com %, faixa da fonte sempre ANY (a do corpo é ignorada)', () => {
    const v = (filters: object, commissionBand: unknown = 'BELOW_5') => {
      const r = validateHuntDefinition({ ...BASE, commissionBand: commissionBand as never, filters });
      return r.ok ? r.value : null;
    };
    expect(v({ minCommissionPct: 20, commissionOperator: 'GT' })).toMatchObject({ commissionBand: 'ANY', filters: { commissionOperator: 'GT' } });
    expect(v({ minCommissionPct: 5, commissionOperator: 'LT' }, 'ABOVE_15')!.commissionBand).toBe('ANY');
    expect(v({ commissionOperator: 'GT' })).toMatchObject({ commissionBand: 'ANY', filters: {} });
    expect(v({ minCommissionPct: 50, commissionOperator: 'GTE' })!.filters.minCommissionPct).toBe(50);
  });
});
