// Entidades e enums do Caçador de Ofertas (espelham os enums Prisma, sem importá-los). Puro.
import type { HuntCommissionBand, HuntLocalFilters, HuntRejectionCounts, HuntScoreFactor, HuntSort } from './HuntCandidate';
import type { HuntProvider, HuntSourceOptions } from './HuntProvider';

export const OFFER_HUNT_STATUSES = ['ACTIVE', 'PAUSED'] as const;
export type OfferHuntStatus = (typeof OFFER_HUNT_STATUSES)[number];

export const OFFER_HUNT_PAUSE_REASONS = [
  'USER', 'SOURCE_UNAVAILABLE', 'CREDENTIAL_REJECTED', 'RISK_NOT_ACCEPTED', 'PLAN_UNAVAILABLE',
] as const;
export type OfferHuntPauseReason = (typeof OFFER_HUNT_PAUSE_REASONS)[number];

/** REVIEW = achados esperam aprovação; AUTO = enfileira direto. */
export const OFFER_HUNT_DELIVERY_MODES = ['REVIEW', 'AUTO'] as const;
export type OfferHuntDeliveryMode = (typeof OFFER_HUNT_DELIVERY_MODES)[number];

export const OFFER_HUNT_RUN_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'] as const;
export type OfferHuntRunStatus = (typeof OFFER_HUNT_RUN_STATUSES)[number];

export const OFFER_HUNT_RUN_TRIGGERS = ['MANUAL', 'SCHEDULED'] as const;
export type OfferHuntRunTrigger = (typeof OFFER_HUNT_RUN_TRIGGERS)[number];

export const OFFER_HUNT_FIND_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'DISMISSED', 'SENT', 'FAILED'] as const;
export type OfferHuntFindStatus = (typeof OFFER_HUNT_FIND_STATUSES)[number];

/** Campos editáveis de uma caçada (criação e edição). `provider` só na criação (fixo depois). */
export interface OfferHuntDefinition {
  /** Marca da caçada (caçadas antigas = SHEIN). */
  provider: HuntProvider;
  name: string;
  /** Ordenação Shein (coluna `sort`); outras marcas = `RECOMMENDED` e ordenam por `sourceOptions.sort`. */
  sort: HuntSort;
  categoryId: string | null;
  /** null = sem filtro de faixa na fonte. */
  commissionBand: HuntCommissionBand | null;
  keyword: string | null;
  /** Filtros da fonte próprios da marca (ML: `sort`, `extraEarningsOnly`, `bestSellersOnly`); Shein = null. */
  sourceOptions: HuntSourceOptions | null;
  filters: HuntLocalFilters;
  aiEnabled: boolean;
  /** Configurada pela IA (só registro/exibição; a IA não muda filtros nas buscas). */
  aiConfigured: boolean;
  /** Intenção dada à IA na configuração (≤ 120), só registro/exibição. */
  aiIntent: string | null;
  topN: number;
  repeatAfterDays: number;
  deliveryMode: OfferHuntDeliveryMode;
  intervalMinutes: number;
  windowStartMinute: number;
  windowEndMinute: number;
  weekdaysMask: number;
}

export interface OfferHunt extends OfferHuntDefinition {
  id: string;
  tenantId: string;
  status: OfferHuntStatus;
  pauseReason: OfferHuntPauseReason | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OfferHuntRunCounters {
  seenCount: number;
  matchedCount: number;
  chosenCount: number;
  sentCount: number;
  aiUsed: boolean;
  aiFallback: boolean;
  /** Quantos candidatos cada filtro local barrou + `repeated`; null = execução sem contagem (antiga/pulada). */
  rejectedBy: HuntRejectionCounts | null;
  /** Até 15 melhores da execução na ordem final; null = execução antiga ou sem fonte. */
  ranking: OfferHuntRankingItem[] | null;
}

/** Item do ranking de uma execução (só exibição; sem link, token nem id de afiliado). */
export interface OfferHuntRankingItem {
  provider: HuntProvider;
  /** Id na marca (Shein = goodsId). */
  productId: string;
  title: string | null;
  /** https no host da marca (o presenter confere de novo). */
  imageUrl: string | null;
  priceCents: number | null;
  discountPercent: number | null;
  /** Comissão primária (Shein 1ª compra; ML percentual do hub). */
  commissionPercent: number | null;
  commissionCents: number | null;
  /** Comissão de recompra (só Shein). */
  returningCommissionPercent: number | null;
  returningCommissionCents: number | null;
  extraCommissionCents: number | null;
  /** Comissão estimada pela tabela (ML sem dado do hub). Ausente no JSON antigo = false. */
  commissionEstimated: boolean;
  salesBucket: number | null;
  reviewsBucket: number | null;
  rating: number | null;
  score: number;
  factors: HuntScoreFactor[];
  aiReason: string | null;
  chosen: boolean;
}

export interface OfferHuntRun extends OfferHuntRunCounters {
  id: string;
  tenantId: string;
  provider: HuntProvider;
  /** null = caçada excluída. */
  huntId: string | null;
  trigger: OfferHuntRunTrigger;
  status: OfferHuntRunStatus;
  /** Código interno (nunca texto da fonte nem token). */
  errorCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** Execução na lista do histórico: sem `ranking` (pesa), só se existe (detalhe em `GET /:id/runs/:runId`). */
export type OfferHuntRunSummary = Omit<OfferHuntRun, 'ranking'> & { hasRanking: boolean };

/** Retrato do item escolhido (só exibição) + pontuação. */
export interface OfferHuntFindSnapshot {
  provider: HuntProvider;
  /** Id na marca (Shein = goodsId; ML = `MLB…`). Repetição é por `provider + productId`. */
  productId: string;
  /** Coluna legada só da Shein (= productId); outras marcas = null. */
  goodsId: string | null;
  skcCode: string | null;
  activityId: string | null;
  title: string;
  /** https e host da marca (normalizado pelo cliente da fonte); null = sem foto. */
  imageUrl: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  discountPercent: number | null;
  commissionPercent: number | null;
  commissionCents: number | null;
  returningCommissionPercent: number | null;
  returningCommissionCents: number | null;
  extraCommissionCents: number | null;
  commissionEstimated: boolean;
  salesBucket: number | null;
  reviewsBucket: number | null;
  rating: number | null;
  score: number;
  factors: HuntScoreFactor[];
  aiReason: string | null;
}

/** Estado do disparo da oferta do achado (espelha `OfferDispatchStatus`, sem importar o Prisma). */
export const HUNT_FIND_DISPATCH_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED'] as const;
export type HuntFindDispatchStatus = (typeof HUNT_FIND_DISPATCH_STATUSES)[number];

/**
 * Envio real da oferta do achado (disparo mais recente da `offerId` atual). O estado `SENT` do achado só
 * quer dizer "entregue à fila"; quem diz se saiu é `dispatchStatus`.
 */
export interface OfferHuntFindDelivery {
  dispatchStatus: HuntFindDispatchStatus;
  /** Hora do envio (só com `SENT`). */
  sentAt: Date | null;
  groupName: string | null;
  sessionName: string | null;
  /** Motivo da falha do disparo (`SEND_TIMEOUT` = pode ainda estar saindo). */
  failureReason: string | null;
  /** Última mudança do disparo (com FAILED, hora do registro da falha). */
  updatedAt: Date;
}

export interface OfferHuntFind extends OfferHuntFindSnapshot {
  id: string;
  tenantId: string;
  huntId: string | null;
  runId: string | null;
  status: OfferHuntFindStatus;
  failureReason: string | null;
  /** Oferta mais recente (o reenvio troca; as anteriores ficam no histórico de ofertas). */
  offerId: string | null;
  /** Quantas vezes foi reenviado e quando (null = nunca). */
  resendCount: number;
  lastResentAt: Date | null;
  resendInFlightUntil: Date | null;
  /** null = sem oferta, ou lido sem o join do disparo. */
  delivery: OfferHuntFindDelivery | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Destino do caçador (1 grupo por tenant). null = não escolhido ou apagado. */
export interface OfferHunterSettings {
  tenantId: string;
  sessionId: string | null;
  conversationId: string | null;
  updatedAt: Date;
}
