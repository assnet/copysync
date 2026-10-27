import type { OfferDispatchStatus } from '../enums/OfferDispatchStatus';
import type { OfferOrigin } from '../enums/OfferOrigin';
import type { OfferStatus } from '../enums/OfferStatus';

/** Um envio na fila, com o resumo da oferta e do grupo destino (leitura do painel). */
export interface SendQueueEntry {
  dispatchId: string;
  offerId: string;
  origin: OfferOrigin;
  offerStatus: OfferStatus;
  title: string | null;
  text: string;
  imageUrl: string | null;
  coupon: string | null;
  sessionId: string | null;
  conversationId: string;
  groupName: string | null;
  groupAvatarUrl: string | null;
  status: OfferDispatchStatus;
  notBefore: Date;
  claimedAt: Date | null;
  updatedAt: Date;
  failureReason: string | null;
}

export interface SendQueueSession {
  id: string;
  name: string;
  status: string;
}

export interface SendQueueFinishedCount {
  sessionId: string | null;
  status: OfferDispatchStatus;
  count: number;
}

export interface SendQueueOpenCount {
  sessionId: string | null;
  /** QUEUED de ofertas SENDING. */
  waiting: number;
  /** QUEUED de ofertas PAUSED. */
  paused: number;
}

export interface SendQueueReadOptions {
  /** Só esta sessão; ausente = todas as sessões do tenant. */
  sessionId?: string;
  /** Início do dia (contadores e concluídos recentes). */
  since: Date;
  /** Abertos lidos POR SESSÃO (os contadores não dependem disso). */
  openLimitPerSession: number;
  /** Concluídos lidos POR SESSÃO. */
  recentLimitPerSession: number;
}

export interface SendQueueSnapshot {
  sessions: SendQueueSession[];
  /** QUEUED/SENDING de ofertas SENDING ou PAUSED, por `notBefore` (até o limite por sessão). */
  open: SendQueueEntry[];
  /** Concluídos (SENT/FAILED/SKIPPED/CANCELLED) desde `since`, mais recentes primeiro (até o limite por sessão). */
  recent: SendQueueEntry[];
  /** Contagem exata dos abertos, sem limite. */
  openCounts: SendQueueOpenCount[];
  finishedToday: SendQueueFinishedCount[];
}

/** Leitura da fila de envio de um tenant. Toda consulta filtra por `tenantId`. */
export interface ISendQueueReader {
  read(tenantId: string, options: SendQueueReadOptions): Promise<SendQueueSnapshot>;
}
