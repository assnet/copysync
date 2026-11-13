import { describe, expect, it } from 'vitest';
import { HUNT_SCORE_NORMALIZATION as N, HUNT_SCORE_WEIGHTS, expectedCommissionCents, scoreHuntCandidate } from './scoreHuntCandidate';
import { huntCandidate } from './huntTestFixtures';
import type { HuntCandidate, HuntScoreFactorKey } from '../../hunter/HuntCandidate';

const NOW = new Date('2026-11-12T15:00:00Z');

/** Fórmula de antes do multimarca (cópia congelada): referência da equivalência Shein. */
function legacyScore(c: HuntCandidate, now: Date): number {
  const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
  const logScale = (v: number, cap: number, ln: (x: number) => number) => clamp01(ln(1 + Math.max(0, v)) / ln(1 + cap));
  const exp = 0.7 * Math.max(0, c.commissionNewCents) + 0.3 * Math.max(0, c.commissionReturningCents);
  const price = (cents: number | null) => {
    if (cents === null || cents <= 0) return 0;
    if (cents < N.priceSweetFromCents) return clamp01((cents - N.priceRampFromCents) / (N.priceSweetFromCents - N.priceRampFromCents));
    if (cents <= N.priceSweetToCents) return 1;
    return clamp01((N.priceZeroAtCents - cents) / (N.priceZeroAtCents - N.priceSweetToCents));
  };
  const ends = c.campaignEndsAt ? c.campaignEndsAt.getTime() - now.getTime() : -1;
  const norm: Record<HuntScoreFactorKey, number> = {
    commission: logScale(exp / 100, N.commissionCapCents / 100, Math.log),
    sales: logScale(c.sales, N.salesCap, Math.log10),
    rating: c.rating === null ? 0 : clamp01((c.rating - N.ratingFloor) / (N.ratingCeil - N.ratingFloor)),
    reviews: logScale(c.reviews, N.reviewsCap, Math.log10),
    rank: c.rank === null || c.rank < 1 ? 0 : clamp01((N.rankZeroAt - c.rank) / (N.rankZeroAt - 1)),
    discount: clamp01(c.discountPct / N.discountCapPct),
    priceBand: price(c.priceCents),
    extraCommission: logScale(c.extraCommissionCents / 100, N.extraCapCents / 100, Math.log),
    endingSoon: ends < 0 ? 0 : clamp01(1 - ends / (N.endingSoonDays * 86_400_000)),
  };
  let tenths = 0;
  for (const k of Object.keys(HUNT_SCORE_WEIGHTS) as HuntScoreFactorKey[]) tenths += Math.round(norm[k] * HUNT_SCORE_WEIGHTS[k] * 10);
  return tenths / 10;
}

/** Gerador determinístico (LCG) para amostra larga e reprodutível. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
}

describe('scoreHuntCandidate — equivalência Shein (multimarca)', () => {
  it('500 candidatos Shein: mesma nota e mesmos fatores/máximos de antes', () => {
    const r = rng(42);
    for (let i = 0; i < 500; i++) {
      const extra = r() < 0.3 ? Math.floor(r() * 2_000) : 0;
      const c = huntCandidate({
        priceCents: r() < 0.05 ? null : Math.floor(r() * 80_000),
        discountPct: Math.floor(r() * 95),
        commissionNewCents: Math.floor(r() * 6_000),
        commissionReturningCents: Math.floor(r() * 3_000),
        extraCommissionCents: extra,
        sales: Math.floor(r() * 20_000),
        reviews: Math.floor(r() * 8_000),
        rating: r() < 0.1 ? null : 3 + r() * 2,
        rank: r() < 0.2 ? null : 1 + Math.floor(r() * 150),
        campaignEndsAt: r() < 0.3 ? new Date(NOW.getTime() + (r() - 0.2) * 10 * 86_400_000) : null,
      });
      const got = scoreHuntCandidate(c, NOW);
      expect(got.score).toBe(legacyScore(c, NOW));
      expect(got.factors.map((f) => [f.key, f.max])).toEqual(Object.entries(HUNT_SCORE_WEIGHTS));
    }
  });
});

describe('scoreHuntCandidate — marca sem fatores (ML)', () => {
  const ml = (p: Partial<HuntCandidate> = {}) => huntCandidate({
    provider: 'MERCADO_LIVRE', productId: 'MLB123456', skc: null, activityId: null, hasSecondaryCommission: false,
    commissionReturningPct: 0, commissionReturningCents: 0, campaignEndsAt: null, ...p,
  });

  it('sem reviews/endingSoon; máximos renormalizados somam ~100; nota 0–100', () => {
    const s = scoreHuntCandidate(ml(), NOW);
    expect(s.factors.map((f) => f.key)).not.toContain('reviews');
    expect(s.factors.map((f) => f.key)).not.toContain('endingSoon');
    expect(s.factors.reduce((a, f) => a + f.max, 0)).toBeCloseTo(100, 0);
    const top = scoreHuntCandidate(ml({
      priceCents: 5_000, discountPct: 90, commissionNewCents: 100_000, extraFlag: true, sales: 1_000_000, rating: 5, rank: 1,
    }), NOW);
    expect(top.score).toBeGreaterThanOrEqual(99.8);
    expect(top.score).toBeLessThanOrEqual(100);
    for (const f of top.factors) expect(f.points).toBeLessThanOrEqual(f.max);
  });

  it('sem secundária: valor esperado = 100% da primária; com: 70/30', () => {
    expect(expectedCommissionCents({ commissionNewCents: 1000, commissionReturningCents: 0, hasSecondaryCommission: false })).toBe(1000);
    expect(expectedCommissionCents({ commissionNewCents: 1000, commissionReturningCents: 0, hasSecondaryCommission: true })).toBe(700);
  });

  it('urgência ML: extraFlag sem R$ dá o ponto cheio do extra; sem flag = 0', () => {
    const pts = (p: Partial<HuntCandidate>) => scoreHuntCandidate(ml(p), NOW).factors.find((f) => f.key === 'extraCommission')!;
    const on = pts({ extraFlag: true, extraCommissionCents: 0 });
    expect(on.points).toBe(on.max);
    expect(pts({ extraFlag: false, extraCommissionCents: 0 }).points).toBe(0);
  });
});
