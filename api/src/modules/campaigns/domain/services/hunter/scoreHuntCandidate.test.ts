import { describe, expect, it } from 'vitest';
import { HUNT_SCORE_WEIGHTS, expectedCommissionCents, scoreHuntCandidate } from './scoreHuntCandidate';
import { huntCandidate } from './huntTestFixtures';

const NOW = new Date('2026-11-12T15:00:00Z');
const score = (p: Parameters<typeof huntCandidate>[0]) => scoreHuntCandidate(huntCandidate(p), NOW).score;
const pts = (p: Parameters<typeof huntCandidate>[0], key: string) =>
  scoreHuntCandidate(huntCandidate(p), NOW).factors.find((f) => f.key === key)!.points;

const ZERO = {
  priceCents: null, retailPriceCents: null, discountPct: 0, commissionNewPct: 0, commissionNewCents: 0,
  commissionReturningPct: 0, commissionReturningCents: 0, extraCommissionCents: 0, sales: 0, reviews: 0,
  rating: null, rank: null, campaignEndsAt: null,
};
const MAX = {
  priceCents: 5_000, discountPct: 90, commissionNewCents: 100_000, commissionReturningCents: 100_000,
  extraCommissionCents: 100_000, sales: 1_000_000, reviews: 1_000_000, rating: 5, rank: 1,
  campaignEndsAt: new Date(NOW.getTime() + 1),
};

describe('scoreHuntCandidate', () => {
  it('pesos somam 100 e grupos 40/30/20/10', () => {
    const w = HUNT_SCORE_WEIGHTS;
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBe(100);
    expect(w.commission).toBe(40);
    expect(w.sales + w.rating + w.reviews + w.rank).toBe(30);
    expect(w.discount + w.priceBand).toBe(20);
    expect(w.extraCommission + w.endingSoon).toBe(10);
  });

  it('limites: tudo zerado = 0; tudo no teto = 100', () => {
    expect(score(ZERO)).toBe(0);
    expect(score(MAX)).toBe(100);
  });

  it('fatores somam a nota e respeitam o máximo', () => {
    for (const p of [{}, ZERO, MAX, { sales: 1234, rating: 4.1, rank: 50, extraCommissionCents: 77 }]) {
      const r = scoreHuntCandidate(huntCandidate(p), NOW);
      const sum = Math.round(r.factors.reduce((a, f) => a + f.points * 10, 0)) / 10;
      expect(r.score).toBe(sum);
      for (const f of r.factors) {
        expect(f.points).toBeGreaterThanOrEqual(0);
        expect(f.points).toBeLessThanOrEqual(f.max);
        expect(f.max).toBe(HUNT_SCORE_WEIGHTS[f.key]);
      }
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it('monotonicidade: mais comissão (novo ou retorno) nunca reduz a nota', () => {
    let prev = -1;
    for (let cents = 0; cents <= 6_000; cents += 37) {
      const s = score({ commissionNewCents: cents });
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    prev = -1;
    for (let cents = 0; cents <= 6_000; cents += 37) {
      const s = score({ commissionReturningCents: cents });
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('monotonicidade de vendas, avaliações, nota, desconto e extra', () => {
    const series: Array<[string, number[]]> = [
      ['sales', [0, 1, 50, 300, 1000, 9999, 50000]],
      ['reviews', [0, 10, 100, 1000, 6000]],
      ['rating', [0, 3, 3.6, 4.2, 4.9, 5]],
      ['discountPct', [0, 10, 40, 70, 95]],
      ['extraCommissionCents', [0, 10, 300, 2000]],
    ];
    for (const [k, vals] of series) {
      const s = vals.map((v) => score({ [k]: v }));
      for (let i = 1; i < s.length; i += 1) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]!);
    }
  });

  it('rank: menor é melhor', () => {
    expect(pts({ rank: 1 }, 'rank')).toBe(4);
    expect(pts({ rank: 51 }, 'rank')).toBe(2);
    expect(pts({ rank: 500 }, 'rank')).toBe(0);
  });

  it('comissão pondera 70% novo + 30% retorno', () => {
    expect(expectedCommissionCents({ commissionNewCents: 1000, commissionReturningCents: 0 })).toBe(700);
    expect(expectedCommissionCents({ commissionNewCents: 0, commissionReturningCents: 1000 })).toBe(300);
    expect(pts({ commissionNewCents: 1000, commissionReturningCents: 0 }, 'commission')).toBeGreaterThan(
      pts({ commissionNewCents: 0, commissionReturningCents: 1000 }, 'commission'),
    );
  });

  it('faixa de preço: R$ 20–150 cheia, fora dela cai', () => {
    expect(pts({ priceCents: 2_000 }, 'priceBand')).toBe(8);
    expect(pts({ priceCents: 15_000 }, 'priceBand')).toBe(8);
    expect(pts({ priceCents: 500 }, 'priceBand')).toBe(0);
    expect(pts({ priceCents: 50_000 }, 'priceBand')).toBe(0);
    expect(pts({ priceCents: 32_500 }, 'priceBand')).toBe(4);
  });

  it('fim da campanha: perto pontua, vencida ou longe não', () => {
    const at = (d: number) => new Date(NOW.getTime() + d * 86_400_000);
    expect(pts({ campaignEndsAt: at(1) }, 'endingSoon')).toBeGreaterThan(pts({ campaignEndsAt: at(5) }, 'endingSoon'));
    expect(pts({ campaignEndsAt: at(8) }, 'endingSoon')).toBe(0);
    expect(pts({ campaignEndsAt: at(-1) }, 'endingSoon')).toBe(0);
  });

  it('determinística', () => {
    const c = huntCandidate({ sales: 777 });
    expect(scoreHuntCandidate(c, NOW)).toEqual(scoreHuntCandidate(c, NOW));
  });
});
