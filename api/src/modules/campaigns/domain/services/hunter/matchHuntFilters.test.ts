import { describe, expect, it } from 'vitest';
import { matchHuntFilters } from './matchHuntFilters';
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
