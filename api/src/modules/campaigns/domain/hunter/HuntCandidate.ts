// Tipos do Caçador de Ofertas (Shein). Puro: sem dependência de infra. Spec: `.specs/features/offer-hunter/`.

/** Candidato normalizado vindo do catálogo de comissão. Dinheiro sempre em centavos inteiros. */
export interface HuntCandidate {
  goodsId: string; // só dígitos (4–12); item sem id válido é descartado pelo cliente
  skc: string | null;
  activityId: string | null;
  title: string | null;
  imageUrl: string | null; // https e host *.ltwebstatic.com; fora disso null
  priceCents: number | null;
  retailPriceCents: number | null; // null quando ≤ preço
  discountPct: number; // 0–100 inteiro
  commissionNewPct: number; // cliente novo, 0–100
  commissionNewCents: number;
  commissionReturningPct: number; // cliente que retorna, 0–100
  commissionReturningCents: number;
  extraCommissionCents: number;
  sales: number; // piso da faixa ("300+" → 300)
  reviews: number; // piso da faixa
  rating: number | null; // 0–5
  rank: number | null; // inteiro ≥ 1; menor = melhor (observado, não contrato)
  categoryId: string | null;
  campaignEndsAt: Date | null;
}

/** Ordenação pedida à fonte. Observado: a Shein ignora por esse caminho; vale como dica. */
export const HUNT_SORTS = ['RECOMMENDED', 'TOP_RATED', 'NEWEST', 'PRICE_ASC', 'PRICE_DESC', 'BEST_SELLING'] as const;
export type HuntSort = (typeof HUNT_SORTS)[number];

/** Faixa de comissão da fonte. Só ABOVE_15 confirmada na tela; demais inferidas pela ordem. */
export const HUNT_COMMISSION_BANDS = ['BELOW_5', 'FROM_5_TO_10', 'FROM_10_TO_15', 'ABOVE_15', 'ANY'] as const;
export type HuntCommissionBand = (typeof HUNT_COMMISSION_BANDS)[number];

/** Filtros aplicados por nós na resposta (HUNT-03). Campo ausente/null = não filtra. */
export interface HuntLocalFilters {
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  minDiscountPct?: number | null;
  /** Comissão de cliente novo (a principal do painel Shein). */
  minCommissionPct?: number | null;
  /** Comissão de cliente novo em centavos. */
  minCommissionCents?: number | null;
  minRating?: number | null;
  minSales?: number | null;
  minReviews?: number | null;
  onlyWithExtra?: boolean | null;
  /** Campanha termina em até N dias a partir de `now` (sem data = fora). */
  endsWithinDays?: number | null;
}

/** Filtros enviados à fonte (HUNT-02); categoria e palavra são escolha do usuário, fora do preset. */
export interface HuntSourceFilters {
  sort: HuntSort;
  commissionBand: HuntCommissionBand;
}

export interface HuntScoreFactor {
  key: HuntScoreFactorKey;
  points: number;
  max: number;
}

export type HuntScoreFactorKey =
  | 'commission'
  | 'sales'
  | 'rating'
  | 'reviews'
  | 'rank'
  | 'discount'
  | 'priceBand'
  | 'extraCommission'
  | 'endingSoon';

export interface HuntScore {
  /** 0–100, 1 casa decimal; igual à soma dos `points`. */
  score: number;
  factors: HuntScoreFactor[];
}
