/**
 * Contrato de `/api/offer-hunts` (api/src/modules/campaigns/presentation: `offerHunt.schema.ts` e
 * `OfferHuntPresenter.ts`). Envelope `{ success, data }` desembrulhado no service. Valores em centavos.
 */

/** Lojas do caçador (espelho de `HUNT_PROVIDERS` da API; subconjunto de `AffiliateProvider`). */
export const HUNT_PROVIDERS = ['SHEIN', 'MERCADO_LIVRE'] as const;
export type HuntProvider = (typeof HUNT_PROVIDERS)[number];

/** Ordenações da fonte do Mercado Livre (`sourceOptions.sort`). A Shein usa a coluna `sort` (`HUNT_SORTS`). */
export const ML_HUNT_SORTS = ['relevance', 'lowest_price', 'highest_price'] as const;
export type MlHuntSort = (typeof ML_HUNT_SORTS)[number];

export const OFFER_HUNT_STATUSES = ['ACTIVE', 'PAUSED'] as const;
export type OfferHuntStatus = (typeof OFFER_HUNT_STATUSES)[number];

/** `USER` = pausa manual; os demais o servidor aplica sozinho (alerta na tela). */
export const OFFER_HUNT_PAUSE_REASONS = [
  'USER', 'SOURCE_UNAVAILABLE', 'CREDENTIAL_REJECTED', 'RISK_NOT_ACCEPTED', 'PLAN_UNAVAILABLE',
] as const;
export type OfferHuntPauseReason = (typeof OFFER_HUNT_PAUSE_REASONS)[number];

/** REVIEW = achados esperam aprovação; AUTO = vão direto ao grupo. */
export const OFFER_HUNT_DELIVERY_MODES = ['REVIEW', 'AUTO'] as const;
export type OfferHuntDeliveryMode = (typeof OFFER_HUNT_DELIVERY_MODES)[number];

export const OFFER_HUNT_RUN_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'] as const;
export type OfferHuntRunStatus = (typeof OFFER_HUNT_RUN_STATUSES)[number];

export const OFFER_HUNT_RUN_TRIGGERS = ['MANUAL', 'SCHEDULED'] as const;
export type OfferHuntRunTrigger = (typeof OFFER_HUNT_RUN_TRIGGERS)[number];

export const OFFER_HUNT_FIND_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'DISMISSED', 'SENT', 'FAILED'] as const;
export type OfferHuntFindStatus = (typeof OFFER_HUNT_FIND_STATUSES)[number];

export const HUNT_SORTS = ['RECOMMENDED', 'TOP_RATED', 'NEWEST', 'PRICE_ASC', 'PRICE_DESC', 'BEST_SELLING'] as const;
export type HuntSort = (typeof HUNT_SORTS)[number];

export const HUNT_COMMISSION_BANDS = ['BELOW_5', 'FROM_5_TO_10', 'FROM_10_TO_15', 'ABOVE_15', 'ANY'] as const;
export type HuntCommissionBand = (typeof HUNT_COMMISSION_BANDS)[number];

/** Predefinições de 1 clique (só mudam filtros; pesos da pontuação são fixos no servidor). */
export const HUNT_PRESETS = ['TOP_COMMISSION', 'BEST_SELLERS', 'BIGGEST_DISCOUNT', 'NEW_ARRIVALS', 'CUSTOM'] as const;
export type HuntPreset = (typeof HUNT_PRESETS)[number];

export const HUNT_SCORE_FACTOR_KEYS = [
  'commission', 'sales', 'rating', 'reviews', 'rank', 'discount', 'priceBand', 'extraCommission', 'endingSoon',
] as const;
export type HuntScoreFactorKey = (typeof HUNT_SCORE_FACTOR_KEYS)[number];

/** Estado da fonte de categorias em `/options` (falha da fonte nunca é erro HTTP). */
export type HuntCategorySourceStatus = 'OK' | 'LOCKED' | 'NO_CREDENTIAL' | 'CREDENTIAL_REJECTED' | 'UNAVAILABLE';

/** Operador do filtro de comissão % (cliente novo): GT >, GTE ≥, LT <. */
export const HUNT_COMMISSION_OPERATORS = ['GT', 'GTE', 'LT'] as const;
export type HuntCommissionOperator = (typeof HUNT_COMMISSION_OPERATORS)[number];
/** Teto do percentual do filtro de comissão (barra 0–50). */
export const HUNT_COMMISSION_PCT_MAX = 50;

/** Motivo de descarte contado por execução: filtro local que barrou ou `repeated`. */
export const HUNT_REJECTION_KEYS = [
  'minPriceCents', 'maxPriceCents', 'minDiscountPct', 'minCommissionPct', 'minCommissionCents', 'minRating',
  'minSales', 'minReviews', 'onlyWithExtra', 'endsWithinDays', 'repeated',
] as const;
export type HuntRejectionKey = (typeof HUNT_REJECTION_KEYS)[number];
/** Quantos candidatos cada chave barrou (um candidato pode contar em várias). */
export type HuntRejectionCounts = Partial<Record<HuntRejectionKey, number>>;

/** Filtros da fonte próprios da marca (Shein: sempre vazio). null = não usa. */
export interface HuntSourceOptions {
  sort: string | null;
  extraEarningsOnly: boolean | null;
  bestSellersOnly: boolean | null;
}

/** Filtro local (chave de `HuntFilters` sem o operador). */
export type HuntLocalFilterKey = Exclude<keyof HuntFilters, 'commissionOperator'>;
export type HuntSourceFilterKey = 'keyword' | 'category' | 'sort' | 'extraEarningsOnly' | 'bestSellersOnly';
/** Shein 1ª compra × recompra; ML percentual único (já inclui ganhos extras). */
export type HuntCommissionModel = 'NEW_RETURNING' | 'SINGLE_WITH_EXTRA_FLAG';

/** O que a marca filtra/ordena: a tela só oferece o que está aqui. */
export interface HuntCapabilities {
  provider: HuntProvider;
  sorts: string[];
  defaultSort: string;
  sourceFilters: HuntSourceFilterKey[];
  localFilters: HuntLocalFilterKey[];
  commissionModel: HuntCommissionModel;
}

export interface HuntScoreFactor {
  key: HuntScoreFactorKey;
  points: number;
  max: number;
}

/** Filtros locais (null = sem filtro). Preço/comissão em centavos; percentuais 0–100; nota 0–5. */
export interface HuntFilters {
  minPriceCents: number | null;
  maxPriceCents: number | null;
  minDiscountPct: number | null;
  /** 0–50, comparado por `commissionOperator`. */
  minCommissionPct: number | null;
  /** null = qualquer comissão (sem filtro %). */
  commissionOperator: HuntCommissionOperator | null;
  minCommissionCents: number | null;
  minRating: number | null;
  minSales: number | null;
  minReviews: number | null;
  onlyWithExtra: boolean | null;
  endsWithinDays: number | null;
}

export interface Hunt {
  id: string;
  /** Loja da caçada (fixa depois de criada). */
  provider: HuntProvider;
  name: string;
  status: OfferHuntStatus;
  pauseReason: OfferHuntPauseReason | null;
  sort: HuntSort;
  categoryId: string | null;
  /** Faixa da fonte derivada pelo servidor do filtro de comissão (só leitura). */
  commissionBand: HuntCommissionBand | null;
  keyword: string | null;
  /** Filtros da fonte da marca (Shein: null). */
  sourceOptions: HuntSourceOptions | null;
  filters: HuntFilters;
  aiEnabled: boolean;
  /** A configuração veio de uma sugestão da IA ("Deixar a IA decidir os filtros"). */
  aiConfigured: boolean;
  aiIntent: string | null;
  topN: number;
  repeatAfterDays: number;
  deliveryMode: OfferHuntDeliveryMode;
  intervalMinutes: number;
  /** Minutos do dia (0–1440), fuso do servidor; padrão 0–1440 = dia todo. */
  windowStartMinute: number;
  windowEndMinute: number;
  /** Bit 0 = domingo … bit 6 = sábado; 127 = todos. */
  weekdaysMask: number;
  /** ISO; comparar só com `serverNow()` (`services/serverClock.ts`). */
  nextRunAt: string | null;
  lastRunAt: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

export interface HuntRun {
  id: string;
  provider: HuntProvider;
  huntId: string | null;
  trigger: OfferHuntRunTrigger;
  status: OfferHuntRunStatus;
  errorCode: string | null;
  seenCount: number;
  matchedCount: number;
  chosenCount: number;
  sentCount: number;
  aiUsed: boolean;
  aiFallback: boolean;
  /** null = execução antiga ou que não chegou à fonte. */
  rejectedBy: HuntRejectionCounts | null;
  /** A execução guardou ranking (a lista não traz o ranking: vem de `getRun` ao abrir). */
  hasRanking: boolean;
  /** Só no detalhe (`GET /:id/runs/:runId`): até 15 melhores; null = não guardado. Ausente na lista. */
  ranking?: HuntRankingItem[] | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Status do disparo da oferta do achado (o `SENT` do achado só quer dizer "entregue à fila"). */
export const HUNT_FIND_DISPATCH_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED'] as const;
export type HuntFindDispatchStatus = (typeof HUNT_FIND_DISPATCH_STATUSES)[number];

export interface HuntFind {
  id: string;
  huntId: string | null;
  runId: string | null;
  status: OfferHuntFindStatus;
  provider: HuntProvider;
  /** Id do produto na loja (Shein goodsId, ML `MLB…`). */
  productId: string;
  /** Só Shein (legado); use `productId`. */
  goodsId: string | null;
  /** Comissão calculada pelo percentual da loja (ML), não lida em valor. */
  commissionEstimated: boolean;
  title: string;
  /** Foto da fonte (https, host da marca) gravada no achado; null = sem foto. */
  imageUrl: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  discountPercent: number | null;
  commissionPercent: number | null;
  commissionCents: number | null;
  returningCommissionPercent: number | null;
  returningCommissionCents: number | null;
  extraCommissionCents: number | null;
  /** Faixa de vendas (ex.: 100 = "100+"), não o número exato. */
  salesBucket: number | null;
  reviewsBucket: number | null;
  rating: number | null;
  /** 0–100, soma dos `factors[].points`. */
  score: number;
  factors: HuntScoreFactor[];
  aiReason: string | null;
  /** Código do erro do envio quando `FAILED`. */
  failureReason: string | null;
  /** Oferta mais recente (o reenvio troca). */
  offerId: string | null;
  /** Envio real do disparo; null = sem oferta. A tela usa isto no lugar do `SENT` do achado. */
  dispatchStatus: HuntFindDispatchStatus | null;
  /** ISO; só com `dispatchStatus` SENT. */
  sentAt: string | null;
  /** Grupo e sessão do último envio (dado sensível: `Blurred`). */
  destination: { groupName: string | null; sessionName: string | null } | null;
  resendCount: number;
  lastResentAt: string | null;
  createdAt: string;
}

/** Item do ranking de "Testar agora" (a imagem vem da fonte, não do storage: só exibição). */
export interface HuntRankingItem {
  provider: HuntProvider;
  productId: string;
  /** Só Shein (legado); use `productId`. */
  goodsId: string | null;
  commissionEstimated: boolean;
  title: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  discountPercent: number | null;
  /** 1ª compra (cliente novo). */
  commissionPercent: number | null;
  commissionCents: number | null;
  /** Recompra (cliente que retorna). */
  returningCommissionPercent: number | null;
  returningCommissionCents: number | null;
  extraCommissionCents: number | null;
  salesBucket: number | null;
  reviewsBucket: number | null;
  rating: number | null;
  score: number;
  factors: HuntScoreFactor[];
  aiReason: string | null;
  chosen: boolean;
}

export interface HuntRunResult {
  runId: string | null;
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  errorCode: string | null;
  seenCount: number;
  matchedCount: number;
  chosenCount: number;
  sentCount: number;
  aiUsed: boolean;
  aiFallback: boolean;
  rejectedBy: HuntRejectionCounts | null;
  ranking: HuntRankingItem[];
  finds: HuntFind[];
  remainingToday: number;
  pausedReason: OfferHuntPauseReason | null;
}

/** Página por cursor opaco: o front só devolve `nextCursor`, nunca `limit`/`offset`. */
export interface HuntPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface HuntApproveResult {
  find: HuntFind;
  offerId: string;
}

/** Uso do dia: `limit` é o entitlement `offer_hunter_finds_per_day`; `runsMax` é a guarda técnica. */
export interface HuntUsage {
  used: number;
  limit: number;
  remaining: number;
  runsToday: number;
  runsMax: number;
}

export interface HuntCategory {
  categoryId: string;
  name: string;
}

export interface HuntPresetOption {
  key: HuntPreset;
  definition: {
    /** Shein: `HuntSort`; demais: ordenação da fonte (`sourceOptions.sort`). */
    source: { sort: string; commissionBand: HuntCommissionBand };
    /** Só os filtros que a predefinição define. */
    local: Partial<HuntFilters>;
  };
}

export interface HuntLimits {
  huntsMax: number;
  topNMax: number;
  topNDefault: number;
  repeatAfterDaysMin: number;
  repeatAfterDaysMax: number;
  repeatAfterDaysDefault: number;
  intervalMinutesMin: number;
  intervalMinutesMax: number;
  keywordMaxLength: number;
  nameMaxLength: number;
  endsWithinDaysMax: number;
}

/** Portões de uso (estados travados da tela, na ordem da execução). */
export interface HuntGates {
  plan: boolean;
  hunterEntitlement: boolean;
  credential: boolean;
  riskAccepted: boolean;
  aiAvailable: boolean;
  destination: boolean;
}

export type HuntGateKey = keyof HuntGates;

export interface HuntOptions {
  provider: HuntProvider;
  capabilities: HuntCapabilities;
  categories: HuntCategory[];
  sourceStatus: HuntCategorySourceStatus;
  sorts: string[];
  /** Vazio desde a faixa derivada no servidor (mantido por compatibilidade). */
  commissionBands: HuntCommissionBand[];
  presets: HuntPresetOption[];
  limits: HuntLimits;
  gates: HuntGates;
}

/** `GET /options/providers`: portões de cada loja, sem chamar a fonte (passo 0 do assistente). */
export interface HuntProviderState {
  provider: HuntProvider;
  credentialState: 'OK' | 'MISSING' | 'REJECTED';
  gates: HuntGates;
}

/** Corpo de `POST /offer-hunts/ai-suggest`. Sem intenção, `pickProduct` precisa ser true. */
export interface HuntAiSuggestInput {
  provider: HuntProvider;
  intent: string | null;
  pickProduct: boolean;
}

/** Rascunho da IA (nada salvo): campo null = a IA não decidiu. `reasons` por caminho (`filters.minPriceCents`…). */
export interface HuntAiSuggestion {
  draft: {
    provider: HuntProvider;
    name: string | null;
    categoryId: string | null;
    keyword: string | null;
    /** Shein: ordenação da coluna `sort` (`HUNT_SORTS`); demais lojas: null (ordem em `sourceOptions.sort`). */
    sort: HuntSort | null;
    sourceOptions: Partial<HuntSourceOptions>;
    filters: Partial<HuntFilters>;
    aiEnabled: boolean | null;
    topN: number | null;
  };
  reasons: Record<string, string>;
  dropped: string[];
  sourceUsed: boolean;
  remainingToday: number;
}

/** Teto técnico de sugestões de IA por conta/dia e tamanho da intenção (espelho de `HUNTER_AI_LIMITS`). */
export const HUNT_AI_SUGGESTIONS_PER_DAY = 5;
export const HUNT_AI_INTENT_MAX = 120;

/** Grupo de destino do caçador; `valid` = sessão e grupo definidos. */
export interface HunterSettings {
  sessionId: string | null;
  conversationId: string | null;
  valid: boolean;
  /** Nome do grupo no chat (confirmação do reenvio); null = sem nome. */
  groupName?: string | null;
}

export interface SaveHunterSettingsInput {
  sessionId: string;
  conversationId: string;
}

/** Corpo de criar (só `name` obrigatório; o resto cai no padrão do servidor). */
export interface CreateHuntInput {
  /** Só na criação vale escolher; na edição precisa ser a mesma (trocar = 422). */
  provider?: HuntProvider;
  name: string;
  sort?: HuntSort;
  categoryId?: string | null;
  keyword?: string | null;
  /** Shein: null; demais marcas: só o que `capabilities.sourceFilters` declara. */
  sourceOptions?: HuntSourceOptions | null;
  filters?: Partial<HuntFilters>;
  aiEnabled?: boolean;
  aiConfigured?: boolean;
  aiIntent?: string | null;
  topN?: number;
  repeatAfterDays?: number;
  deliveryMode?: OfferHuntDeliveryMode;
  intervalMinutes?: number;
  windowStartMinute?: number;
  windowEndMinute?: number;
  weekdaysMask?: number;
}

/** Corpo de editar: ao menos um campo. */
export type UpdateHuntInput = Partial<CreateHuntInput>;

/** Erro rejeitado pelo `apiClient` (interceptor expõe `status`, `code`, `meta`). */
export interface OfferHunterApiError {
  status?: number;
  code?: string;
  meta?: Record<string, unknown> | null;
}
