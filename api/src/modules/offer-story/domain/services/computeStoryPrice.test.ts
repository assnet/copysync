import { describe, expect, it } from 'vitest';
import { computeStoryPrice } from './computeStoryPrice';

const p = (priceCents: number | null, originalPriceCents: number | null = null) => ({ priceCents, originalPriceCents });

/** Tabela "Regras de preço" de `.specs/features/offer-story/spec.md`. */
describe('computeStoryPrice', () => {
  it.each([
    ['sem desconto, original maior → de/por', p(9990, 12990), null, { fromCents: 12990, toCents: 9990 }],
    ['sem desconto, sem original → só por', p(9990), null, { fromCents: null, toCents: 9990 }],
    ['sem desconto, original igual → só por', p(9990, 9990), null, { fromCents: null, toCents: 9990 }],
    ['sem desconto, original menor → só por', p(9990, 5000), null, { fromCents: null, toCents: 9990 }],
    ['desconto, original maior → de = original', p(10000, 15000), 10, { fromCents: 15000, toCents: 9000 }],
    ['desconto, sem original → de = price', p(10000), 10, { fromCents: 10000, toCents: 9000 }],
    ['desconto, original menor → de = price', p(10000, 8000), 25, { fromCents: 10000, toCents: 7500 }],
    ['desconto arredonda', p(9990), 15, { fromCents: 9990, toCents: 8492 }],
    ['desconto 90%', p(1000), 90, { fromCents: 1000, toCents: 100 }],
    ['price nulo → sem preço', p(null, 12990), null, { fromCents: null, toCents: null }],
    ['price nulo com desconto → sem preço', p(null), 10, { fromCents: null, toCents: null }],
    ['price zero → sem preço', p(0, 1000), null, { fromCents: null, toCents: null }],
  ] as const)('%s', (_label, product, discount, expected) => {
    expect(computeStoryPrice(product, discount)).toEqual(expected);
  });
  it('desconto que arredonda para zero não mostra preço', () => {
    expect(computeStoryPrice({ priceCents: 1, originalPriceCents: null }, 90)).toEqual({ fromCents: null, toCents: null });
  });
});
