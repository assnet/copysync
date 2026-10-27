import type { OfferDispatch } from '../entities/OfferDispatch';
import type { OfferDispatchStatus } from '../enums/OfferDispatchStatus';

export interface NewOfferDispatchItem {
  conversationId: string;
  /** Faixa: sessão dona da conversa. */
  sessionId: string;
  notBefore: Date;
  /** Intervalo mínimo (s) desde o início do último envio da mesma sessão. */
  gapSeconds: number;
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
   * Worker, cross-tenant: QUEUED vencidos de ofertas SENDING → SENDING (oferta PAUSED segura a
   * fila). **No máximo um por sessão**, e só se a sessão não tem envio SENDING nem envio SENT
   * iniciado há menos de `gapSeconds` do candidato. Claims concorrentes serializados. Cada envio
   * volta com `claimToken` novo (posse); todo passo seguinte exige esse token.
   */
  claimDue(now: Date, limit: number): Promise<OfferDispatch[]>;
  /**
   * Fim de cada faixa: por sessão, o maior `notBefore` aberto (QUEUED/SENDING) de ofertas SENDING
   * que já começaram até `startAt` (sem início agendado ou agendado até lá). Oferta agendada para
   * depois não segura quem entra antes. Sessão sem nada à frente não aparece no mapa.
   */
  laneTails(tenantId: string, sessionIds: readonly string[], startAt: Date): Promise<Map<string, Date>>;
  /**
   * Retomar: QUEUED da oferta, na ordem de `notBefore`, recebem `slots[i]`. Slot a menos que
   * envio mantém o `notBefore` antigo. Retorna quantos mudaram.
   */
  rescheduleQueued(offerId: string, tenantId: string, slots: Date[]): Promise<number>;
  /** Parar: QUEUED da oferta → CANCELLED. O que está SENDING termina. Retorna quantos. */
  cancelQueued(offerId: string, tenantId: string): Promise<number>;
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
  /**
   * Sessão fora do ar na vez do envio: SENDING (com o token da posse, oferta SENDING/PAUSED) →
   * QUEUED com `notBefore = retryAt` e `waitingSessionSince` (mantém o primeiro). O claim dá prioridade a ele e não abre
   * outro envio da sessão antes: a ordem se mantém. false = posse perdida.
   */
  deferForOfflineSession(id: string, tenantId: string, claimToken: string, retryAt: Date, waitingSince: Date): Promise<boolean>;
  /**
   * Desistência (sessão fora do ar tempo demais), só em ofertas SENDING: QUEUED da sessão vencidos
   * (`notBefore <= now`) ou da oferta `offerId` → FAILED com o motivo. Retorna quantos.
   */
  failOverdueInSession(tenantId: string, sessionId: string, now: Date, failureReason: string, offerId: string): Promise<number>;
  /** Só SENDING com o mesmo `claimToken` → resultado; false se a posse já não é deste token. */
  markResult(id: string, tenantId: string, claimToken: string, result: OfferDispatchResult): Promise<boolean>;
  /**
   * Worker, cross-tenant: ofertas SENDING/PAUSED sem envio aberto (finalize perdido por
   * erro/queda, ou pausa quando o último envio já estava saindo). Cada item carrega `tenantId`;
   * o finalize volta a filtrar por ele.
   */
  findSendingWithoutOpenDispatches(limit: number): Promise<{ id: string; tenantId: string }[]>;
  /** QUEUED + SENDING. */
  countOpen(offerId: string, tenantId: string): Promise<number>;
  countByStatus(offerId: string, tenantId: string): Promise<Record<OfferDispatchStatus, number>>;
}
