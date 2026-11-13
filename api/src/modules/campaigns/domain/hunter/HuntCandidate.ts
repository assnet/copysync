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

/** Operador da comissão mínima: maior que, igual ou maior que, menor que (sobre a comissão de cliente novo). */
export const HUNT_COMMISSION_OPERATORS = ['GT', 'GTE', 'LT'] as const;
export type HuntCommissionOperator = (typeof HUNT_COMMISSION_OPERATORS)[number];
/** Teto do percentual do filtro de comissão (controle do painel 0–50). */
export const HUNT_COMMISSION_PCT_MAX = 50;

/** Filtros aplicados por nós na resposta (HUNT-03). Campo ausente/null = não filtra. */
export interface HuntLocalFilters {
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  minDiscountPct?: number | null;
  /** Percentual da comissão de cliente novo (a principal do painel Shein), 0–50; comparado por `commissionOperator`. */
  minCommissionPct?: number | null;
  /** null = sem filtro de comissão %. Sempre junto com `minCommissionPct` (normalizado na validação). */
  commissionOperator?: HuntCommissionOperator | null;
  /** Comissão de cliente novo em centavos. */
  minCommissionCents?: number | null;
  minRating?: number | null;
  minSales?: number | null;
  minReviews?: number | null;
  onlyWithExtra?: boolean | null;
  /** Campanha termina em até N dias a partir de `now` (sem data = fora). */
  endsWithinDays?: number | null;
}

/** Chave de filtro local que pode recusar um candidato (mesmo nome do campo em `HuntLocalFilters`). */
export type HuntFilterKey = Exclude<keyof HuntLocalFilters, 'commissionOperator'>;

/**
 * Motivo de descarte gravado na execução: filtro local que barrou ou `repeated` (escolhido dentro da
 * janela `repeatAfterDays`). Um candidato barrado por 2 filtros conta nos 2.
 */
export const HUNT_REJECTION_KEYS = [
  'minPriceCents', 'maxPriceCents', 'minDiscountPct', 'minCommissionPct', 'minCommissionCents', 'minRating',
  'minSales', 'minReviews', 'onlyWithExtra', 'endsWithinDays', 'repeated',
] as const satisfies readonly (HuntFilterKey | 'repeated')[];
export type HuntRejectionKey = (typeof HUNT_REJECTION_KEYS)[number];
// Toda chave de filtro local está na lista (falha de compilação se um filtro novo ficar de fora)
const _allFilterKeysListed: Exclude<HuntFilterKey, HuntRejectionKey> extends never ? true : never = true;
void _allFilterKeysListed;
export type HuntRejectionCounts = Partial<Record<HuntRejectionKey, number>>;

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
