import type { OfferHuntFind, OfferHuntFindSnapshot, OfferHuntFindStatus } from '../../hunter/OfferHunt';
import type { OfferHuntPageCursor } from './IOfferHuntRunRepository';

export interface NewOfferHuntFind extends OfferHuntFindSnapshot {
  huntId: string | null;
  runId: string | null;
  status: Extract<OfferHuntFindStatus, 'PENDING_REVIEW' | 'APPROVED'>;
}

export interface OfferHuntFindTransition {
  offerId?: string | null;
  failureReason?: string | null;
}

/** Achados (só os escolhidos). O teto diário de ofertas garimpadas conta linhas daqui. */
export interface IOfferHuntFindRepository {
  /**
   * Grava `min(finds.length, limit − achados do tenant desde since)` na ordem dada, numa transação
   * serializada por tenant (desenho do `createWithinDailyLimit`). Devolve os gravados (pode ser `[]`).
   * Com `repeatSince`, descarta antes de contar o saldo o goodsId que a mesma caçada já escolheu desde
   * essa data (inclusive no próprio lote), dentro do mesmo lock: execuções simultâneas não repetem item.
   */
  insertWithinDailyLimit(
    tenantId: string, finds: NewOfferHuntFind[], quota: { since: Date; limit: number; repeatSince?: Date },
  ): Promise<OfferHuntFind[]>;
  countCreatedSince(tenantId: string, since: Date): Promise<number>;
  /** goodsIds já escolhidos pela caçada desde `since` (qualquer estado): regra de repetição. */
  recentGoodsIds(tenantId: string, huntId: string, since: Date): Promise<Set<string>>;
  /** Com `delivery` (disparo mais recente da oferta, grupo e sessão). */
  findById(tenantId: string, id: string): Promise<OfferHuntFind | null>;
  /** Com `delivery`, como `findById`. */
  listByHunt(tenantId: string, huntId: string, page: { limit: number; after?: OfferHuntPageCursor }): Promise<OfferHuntFind[]>;
  /** CAS: só muda se o estado atual está em `from`. */
  transition(tenantId: string, id: string, from: OfferHuntFindStatus[], to: OfferHuntFindStatus, extra?: OfferHuntFindTransition): Promise<boolean>;
  /**
   * CAS da entrega interrompida: APPROVED sem `offerId` com `updatedAt < before` → renova `updatedAt`
   * (segue APPROVED). Dois pedidos simultâneos: só um vence.
   */
  reclaimStaleApproved(tenantId: string, id: string, before: Date): Promise<boolean>;
  /**
   * CAS do reenvio: só passa se a oferta atual ainda é `offerId` e o último reenvio foi antes de
   * `now − cooldownMs` (clique duplo/2 abas não criam 2 ofertas). Grava `lastResentAt = now`.
   */
  claimResend(tenantId: string, id: string, offerId: string, now: Date, cooldownMs: number): Promise<boolean>;
  /** Reenvio enfileirado: troca `offerId`, achado `SENT`, `resendCount + 1`. */
  recordResend(tenantId: string, id: string, offerId: string): Promise<void>;
}
