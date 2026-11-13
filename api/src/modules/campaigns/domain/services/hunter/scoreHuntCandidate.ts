import type { HuntCandidate, HuntFilterKey, HuntScore, HuntScoreFactor, HuntScoreFactorKey } from '../../hunter/HuntCandidate';
import type { HuntCapabilities } from '../../hunter/HuntProvider';
import { huntCapabilities } from './huntCapabilities';

/**
 * Pesos (pontos máximos) por fator. Soma = 100. Grupos: comissão 40 · prova social 30 · preço 20 ·
 * urgência/extra 10. Única fonte dos pesos: telas e testes leem daqui.
 */
export const HUNT_SCORE_WEIGHTS: Readonly<Record<HuntScoreFactorKey, number>> = {
  commission: 40,
  sales: 12,
  rating: 8,
  reviews: 6,
  rank: 4,
  discount: 12,
  priceBand: 8,
  extraCommission: 6,
  endingSoon: 4,
};

/**
 * Normalizações (determinísticas, todas em [0, 1]):
 * - commission: valor esperado = 70% cliente novo + 30% cliente que retorna (o link divulgado em grupo alcança
 *   mais gente nova; o retorno é bônus). Escala log com teto R$ 30: ln(1+R$)/ln(1+30).
 * - sales: log10(1+v)/log10(1+10 000); reviews: log10(1+v)/log10(1+5 000).
 * - rating: linear de 3,5 (0) a 5,0 (1); sem nota = 0.
 * - rank: 1 = 1, cai linear até 0 no 101º; sem rank = 0 (menor é melhor, observado).
 * - discount: linear até 70%.
 * - priceBand: faixa boa R$ 20–150 = 1; sobe linear de R$ 5 a 20; desce linear de R$ 150 a 500; sem preço = 0.
 * - extraCommission: log com teto R$ 10. endingSoon: termina em ≤ 7 dias, mais perto = mais ponto; vencida/sem data = 0.
 */
export const HUNT_SCORE_NORMALIZATION = {
  commissionNewShare: 0.7,
  commissionReturningShare: 0.3,
  commissionCapCents: 3_000,
  salesCap: 10_000,
  reviewsCap: 5_000,
  ratingFloor: 3.5,
  ratingCeil: 5,
  rankZeroAt: 101,
  discountCapPct: 70,
  priceRampFromCents: 500,
  priceSweetFromCents: 2_000,
  priceSweetToCents: 15_000,
  priceZeroAtCents: 50_000,
  extraCapCents: 1_000,
  endingSoonDays: 7,
} as const;

const N = HUNT_SCORE_NORMALIZATION;
const DAY_MS = 86_400_000;

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const logScale = (v: number, cap: number, ln: (x: number) => number) => clamp01(ln(1 + Math.max(0, v)) / ln(1 + cap));

/**
 * Valor esperado da comissão em centavos: com secundária (Shein) 70% primária + 30% secundária; sem secundária
 * (ML) 100% da primária. `hasSecondaryCommission` ausente = com secundária (comportamento original).
 */
export function expectedCommissionCents(
  c: Pick<HuntCandidate, 'commissionNewCents' | 'commissionReturningCents'> & { hasSecondaryCommission?: boolean },
): number {
  if (c.hasSecondaryCommission === false) return Math.max(0, c.commissionNewCents);
  return N.commissionNewShare * Math.max(0, c.commissionNewCents) + N.commissionReturningShare * Math.max(0, c.commissionReturningCents);
}

/**
 * Fator que depende de um dado que só existe se a marca o oferece (mesmo dado do filtro local). Marca sem o filtro
 * = fator fora da nota (renormalizada). `rank` não tem filtro: sempre entra (sem rank = 0, como hoje).
 */
const FACTOR_DATA: Readonly<Partial<Record<HuntScoreFactorKey, HuntFilterKey>>> = {
  commission: 'minCommissionPct',
  sales: 'minSales',
  rating: 'minRating',
  reviews: 'minReviews',
  discount: 'minDiscountPct',
  priceBand: 'minPriceCents',
  extraCommission: 'onlyWithExtra',
  endingSoon: 'endsWithinDays',
};

/** Fatores da nota para a marca, na ordem fixa de `HUNT_SCORE_WEIGHTS`. */
export function huntScoreFactorsFor(caps: Pick<HuntCapabilities, 'localFilters'>): HuntScoreFactorKey[] {
  return (Object.keys(HUNT_SCORE_WEIGHTS) as HuntScoreFactorKey[]).filter((k) => {
    const data = FACTOR_DATA[k];
    return data === undefined || caps.localFilters.includes(data);
  });
}

function priceBand(cents: number | null): number {
  if (cents === null || cents <= 0) return 0;
  if (cents < N.priceSweetFromCents) return clamp01((cents - N.priceRampFromCents) / (N.priceSweetFromCents - N.priceRampFromCents));
  if (cents <= N.priceSweetToCents) return 1;
  return clamp01((N.priceZeroAtCents - cents) / (N.priceZeroAtCents - N.priceSweetToCents));
}

function endingSoon(ends: Date | null, now: Date): number {
  if (!ends) return 0;
  const left = ends.getTime() - now.getTime();
  if (left < 0) return 0;
  return clamp01(1 - left / (N.endingSoonDays * DAY_MS));
}

/**
 * Nota 0–100 (1 casa) e fatores; a nota é exatamente a soma dos pontos dos fatores. Fatores que a marca não tem
 * saem e o máximo de cada fator restante é escalado para a soma dar 100 (marca com todos os fatores = pesos
 * originais, mesmas notas). Extra: R$ em escala log; sem R$ mas com `extraFlag` (ML "ganhos extras") = ponto cheio.
 */
export function scoreHuntCandidate(c: HuntCandidate, now: Date): HuntScore {
  const keys = huntScoreFactorsFor(huntCapabilities(c.provider));
  const total = keys.reduce((a, k) => a + HUNT_SCORE_WEIGHTS[k], 0);
  const scale = total > 0 ? 100 / total : 0;
  const norm: Record<HuntScoreFactorKey, number> = {
    commission: logScale(expectedCommissionCents(c) / 100, N.commissionCapCents / 100, Math.log),
    sales: logScale(c.sales, N.salesCap, Math.log10),
    rating: c.rating === null ? 0 : clamp01((c.rating - N.ratingFloor) / (N.ratingCeil - N.ratingFloor)),
    reviews: logScale(c.reviews, N.reviewsCap, Math.log10),
    rank: c.rank === null || c.rank < 1 ? 0 : clamp01((N.rankZeroAt - c.rank) / (N.rankZeroAt - 1)),
    discount: clamp01(c.discountPct / N.discountCapPct),
    priceBand: priceBand(c.priceCents),
    extraCommission: c.extraCommissionCents > 0
      ? logScale(c.extraCommissionCents / 100, N.extraCapCents / 100, Math.log)
      : c.extraFlag ? 1 : 0,
    endingSoon: endingSoon(c.campaignEndsAt, now),
  };
  // Em décimos inteiros: a soma não sofre erro de ponto flutuante
  let tenths = 0;
  const factors: HuntScoreFactor[] = keys.map((key) => {
    const exact = HUNT_SCORE_WEIGHTS[key] * scale;
    const max = Math.round(exact * 10) / 10;
    // Pontos nunca passam do máximo exibido (arredondado)
    const t = Math.min(Math.round(max * 10), Math.round(norm[key] * exact * 10));
    tenths += t;
    return { key, points: t / 10, max };
  });
  return { score: Math.min(1000, tenths) / 10, factors };
}
