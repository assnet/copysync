import type { OfferDispatch } from '../entities/OfferDispatch';
import type { OfferDispatchStatus } from '../enums/OfferDispatchStatus';

export interface NewOfferDispatchItem {
  conversationId: string;
  notBefore: Date;
}

export type OfferDispatchResult =
  | { status: 'SENT'; chatMessageId: string }
  | { status: 'FAILED' | 'SKIPPED'; failureReason: string };

/** Valor validado no envio; a transição só acontece se a oferta ainda tiver esse valor. */
export interface StartSendingExpectation {
  mentionAll: boolean;
}

export interface IOfferDispatchRepository {
  /**
   * Numa transação: oferta DRAFT → SENDING (condicional) + cria os envios. A transição exige o
   * `mentionAll` validado no envio: edição no meio não passa sem nova validação.
   * null se a oferta não existe, não está em DRAFT ou mudou o `mentionAll`.
   */
  startSending(
    offerId: string,
    tenantId: string,
    expected: StartSendingExpectation,
    items: NewOfferDispatchItem[],
  ): Promise<OfferDispatch[] | null>;
  listByOffer(offerId: string, tenantId: string): Promise<OfferDispatch[]>;
  /**
   * Worker, cross-tenant: QUEUED vencidos → SENDING com SKIP LOCKED. Cada envio volta com
   * `claimToken` novo (posse); todo passo seguinte exige esse token.
   */
  claimDue(now: Date, limit: number): Promise<OfferDispatch[]>;
  /**
   * Renova a posse logo antes de enviar (`claimedAt = now`). false = envio já não é deste
   * token (devolvido à fila e reivindicado por outro): não envia.
   */
  touchClaim(id: string, claimToken: string): Promise<boolean>;
  /**
   * Worker, cross-tenant: SENDING com claimedAt < olderThan e sem `chatMessageId` → QUEUED,
   * token zerado. Retorna quantos.
   */
  releaseStale(olderThan: Date): Promise<number>;
  /** Só SENDING com o mesmo `claimToken` → resultado; false se a posse já não é deste token. */
  markResult(id: string, tenantId: string, claimToken: string, result: OfferDispatchResult): Promise<boolean>;
  /**
   * Worker, cross-tenant: ofertas SENDING sem envio aberto (finalize perdido por erro/queda).
   * Cada item carrega `tenantId`; o finalize volta a filtrar por ele.
   */
  findSendingWithoutOpenDispatches(limit: number): Promise<{ id: string; tenantId: string }[]>;
  /** QUEUED + SENDING. */
  countOpen(offerId: string, tenantId: string): Promise<number>;
  countByStatus(offerId: string, tenantId: string): Promise<Record<OfferDispatchStatus, number>>;
}
