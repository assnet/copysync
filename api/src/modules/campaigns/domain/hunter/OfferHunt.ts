// Entidades e enums do Caçador de Ofertas (espelham os enums Prisma, sem importá-los). Puro.
import type { HuntCommissionBand, HuntLocalFilters, HuntScoreFactor, HuntSort } from './HuntCandidate';

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

/** Campos editáveis de uma caçada (criação e edição). */
export interface OfferHuntDefinition {
  name: string;
  sort: HuntSort;
  categoryId: string | null;
  /** null = sem filtro de faixa na fonte. */
  commissionBand: HuntCommissionBand | null;
  keyword: string | null;
  filters: HuntLocalFilters;
  aiEnabled: boolean;
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
}

export interface OfferHuntRun extends OfferHuntRunCounters {
  id: string;
  tenantId: string;
  /** null = caçada excluída. */
  huntId: string | null;
  trigger: OfferHuntRunTrigger;
  status: OfferHuntRunStatus;
  /** Código interno (nunca texto da fonte nem token). */
  errorCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** Retrato do item escolhido (só exibição) + pontuação. */
export interface OfferHuntFindSnapshot {
  goodsId: string;
  skcCode: string | null;
  activityId: string | null;
  title: string;
  /** https e host *.ltwebstatic.com (normalizado pelo cliente da fonte); null = sem foto. */
  imageUrl: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  discountPercent: number | null;
  commissionPercent: number | null;
  commissionCents: number | null;
  returningCommissionPercent: number | null;
  returningCommissionCents: number | null;
  extraCommissionCents: number | null;
  salesBucket: number | null;
  reviewsBucket: number | null;
  rating: number | null;
  score: number;
  factors: HuntScoreFactor[];
  aiReason: string | null;
}

export interface OfferHuntFind extends OfferHuntFindSnapshot {
  id: string;
  tenantId: string;
  huntId: string | null;
  runId: string | null;
  status: OfferHuntFindStatus;
  failureReason: string | null;
  offerId: string | null;
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
