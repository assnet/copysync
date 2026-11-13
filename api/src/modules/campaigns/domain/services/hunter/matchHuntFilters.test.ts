import { describe, expect, it } from 'vitest';
import { countHuntRejections, huntFilterRejections, matchHuntFilters } from './matchHuntFilters';
import { huntCandidate } from './huntTestFixtures';

const NOW = new Date('2026-11-12T15:00:00Z');
const DAY = 86_400_000;
const c = huntCandidate();

describe('matchHuntFilters', () => {
  it('sem filtro → passa', () => expect(matchHuntFilters(c, {}, NOW)).toBe(true));

  it('null em todos os campos → passa', () => {
    const f = {
      minPriceCents: null, maxPriceCents: null, minDiscountPct: null, minCommissionPct: null, minCommissionCents: null,
      minRating: null, minSales: null, minReviews: null, onlyWithExtra: null, endsWithinDays: null,
    };
    expect(matchHuntFilters(c, f, NOW)).toBe(true);
  });

  it.each([
    ['minPriceCents', { minPriceCents: 5990 }, { minPriceCents: 5991 }],
    ['maxPriceCents', { maxPriceCents: 5990 }, { maxPriceCents: 5989 }],
    ['minDiscountPct', { minDiscountPct: 40 }, { minDiscountPct: 41 }],
    ['minCommissionPct', { minCommissionPct: 15 }, { minCommissionPct: 15.5 }],
    ['minCommissionCents', { minCommissionCents: 899 }, { minCommissionCents: 900 }],
    ['minRating', { minRating: 4.8 }, { minRating: 4.9 }],
    ['minSales', { minSales: 300 }, { minSales: 301 }],
    ['minReviews', { minReviews: 1000 }, { minReviews: 1001 }],
  ])('%s: limite inclusivo', (_k, pass, fail) => {
    expect(matchHuntFilters(c, pass, NOW)).toBe(true);
    expect(matchHuntFilters(c, fail, NOW)).toBe(false);
  });

  it('dado ausente com filtro ligado → não passa', () => {
    const empty = huntCandidate({ priceCents: null, rating: null });
    expect(matchHuntFilters(empty, { minPriceCents: 1 }, NOW)).toBe(false);
    expect(matchHuntFilters(empty, { maxPriceCents: 1_000_000 }, NOW)).toBe(false);
    expect(matchHuntFilters(empty, { minRating: 1 }, NOW)).toBe(false);
  });

  it('só com extra', () => {
    expect(matchHuntFilters(c, { onlyWithExtra: true }, NOW)).toBe(false);
    expect(matchHuntFilters(huntCandidate({ extraCommissionCents: 50 }), { onlyWithExtra: true }, NOW)).toBe(true);
    expect(matchHuntFilters(c, { onlyWithExtra: false }, NOW)).toBe(true);
  });

  it('termina em até N dias', () => {
    const at = (ms: number) => huntCandidate({ campaignEndsAt: new Date(NOW.getTime() + ms) });
    expect(matchHuntFilters(at(3 * DAY), { endsWithinDays: 3 }, NOW)).toBe(true);
    expect(matchHuntFilters(at(3 * DAY + 1), { endsWithinDays: 3 }, NOW)).toBe(false);
    expect(matchHuntFilters(at(-1), { endsWithinDays: 3 }, NOW)).toBe(false);
    expect(matchHuntFilters(c, { endsWithinDays: 3 }, NOW)).toBe(false);
  });
});

describe('huntFilterRejections', () => {
  it('sem filtro → nenhuma recusa', () => expect(huntFilterRejections(c, {}, NOW)).toEqual([]));

  it('devolve todas as chaves que falharam, na ordem dos campos', () => {
    const f = { minRating: 4.9, minSales: 301, minReviews: 1001, minPriceCents: 1, maxPriceCents: 1_000_000 };
    expect(huntFilterRejections(c, f, NOW)).toEqual(['minRating', 'minSales', 'minReviews']);
  });

  it('dado ausente conta para a chave do filtro ligado', () => {
    const empty = huntCandidate({ priceCents: null, rating: null, campaignEndsAt: null });
    expect(huntFilterRejections(empty, { minPriceCents: 1, maxPriceCents: 9, minRating: 1, endsWithinDays: 3 }, NOW))
      .toEqual(['minPriceCents', 'maxPriceCents', 'minRating', 'endsWithinDays']);
  });

  it('passa/não passa igual a matchHuntFilters', () => {
    const cases = [{}, { minSales: 301 }, { onlyWithExtra: true }, { minCommissionPct: 15 }, { endsWithinDays: 3 }];
    for (const f of cases) expect(huntFilterRejections(c, f, NOW).length === 0).toBe(matchHuntFilters(c, f, NOW));
  });

  it('countHuntRejections soma por chave', () => {
    const counts = {};
    countHuntRejections(counts, ['minSales', 'minReviews']);
    countHuntRejections(counts, ['minSales']);
    countHuntRejections(counts, ['repeated']);
    expect(counts).toEqual({ minSales: 2, minReviews: 1, repeated: 1 });
  });
});

describe('comissão com operador (cliente novo)', () => {
  const at = (pct: number) => huntCandidate({ commissionNewPct: pct });
  it('borda 15: GT não passa, GTE passa, LT não passa', () => {
    expect(matchHuntFilters(at(15), { minCommissionPct: 15, commissionOperator: 'GT' }, NOW)).toBe(false);
    expect(matchHuntFilters(at(15), { minCommissionPct: 15, commissionOperator: 'GTE' }, NOW)).toBe(true);
    expect(matchHuntFilters(at(15), { minCommissionPct: 15, commissionOperator: 'LT' }, NOW)).toBe(false);
  });
  it('GT/LT fora da borda e operador ausente = GTE', () => {
    expect(matchHuntFilters(at(16), { minCommissionPct: 15, commissionOperator: 'GT' }, NOW)).toBe(true);
    expect(matchHuntFilters(at(14), { minCommissionPct: 15, commissionOperator: 'LT' }, NOW)).toBe(true);
    expect(matchHuntFilters(at(15), { minCommissionPct: 15 }, NOW)).toBe(true);
  });
  it('dado ausente com filtro ligado não passa e conta em minCommissionPct', () => {
    const c0 = huntCandidate({ commissionNewPct: Number.NaN });
    expect(huntFilterRejections(c0, { minCommissionPct: 50, commissionOperator: 'LT' }, NOW)).toEqual(['minCommissionPct']);
  });
});
