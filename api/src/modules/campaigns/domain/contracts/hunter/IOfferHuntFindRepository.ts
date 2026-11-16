import type { HuntProvider } from '../../hunter/HuntProvider';
import type { OfferHuntFind, OfferHuntFindSnapshot, OfferHuntFindStatus } from '../../hunter/OfferHunt';
import type { OfferHuntPageCursor } from './IOfferHuntRunRepository';

export interface NewOfferHuntFind extends OfferHuntFindSnapshot {
  huntId: string | null;
  runId: string | null;
  status: Extract<OfferHuntFindStatus, 'PENDING_REVIEW' | 'APPROVED'>;
}

export interface ResendClaimOptions {
  cooldownMs: number;
  inFlightMs: number;
  /** Início do dia do teto (fuso do produto). */
  dayStart: Date;
  dailyMax: number;
}

/** `number` = número do reenvio (sourceKey `hunt:<id>:r<number>`). */
export type ResendClaim = { kind: 'CLAIMED'; number: number } | { kind: 'PENDING' } | { kind: 'DAILY_LIMIT' };

export interface OfferHuntFindTransition {
  offerId?: string | null;
  failureReason?: string | null;
}

/** Reaproveitamento do ranking: gravado, ou já enviado desta execução (`RUN`) / repetido na janela (`REPEATED`). */
export type RankingFindInsert =
  | { kind: 'INSERTED'; find: OfferHuntFind }
  | { kind: 'ALREADY_SENT'; reason: 'RUN' | 'REPEATED' };

/** Achados (só os escolhidos). O teto diário de ofertas garimpadas conta linhas daqui (fora `fromRanking`). */
export interface IOfferHuntFindRepository {
  /**
   * Grava `min(finds.length, limit − achados do tenant desde since)` na ordem dada, numa transação
   * serializada por tenant (desenho do `createWithinDailyLimit`). Devolve os gravados (pode ser `[]`).
   * Com `repeatSince`, descarta antes de contar o saldo o produto (`provider + productId`) que a mesma caçada já
   * escolheu desde essa data (inclusive no próprio lote), dentro do mesmo lock: execuções simultâneas não repetem item.
   */
  insertWithinDailyLimit(
    tenantId: string, finds: NewOfferHuntFind[], quota: { since: Date; limit: number; repeatSince?: Date },
  ): Promise<OfferHuntFind[]>;
  /**
   * Item do ranking reaproveitado (fora do teto do dia; grava `fromRanking = true`): no mesmo lock por tenant do
   * `insertWithinDailyLimit`, recusa se a execução (`find.runId`) já tem achado do produto que não seja FAILED/DISMISSED, ou se a caçada
   * escolheu o produto desde `repeatSince` (fora o FAILED/DISMISSED desta execução: o reenvio cria linha nova).
   * Dois pedidos simultâneos do mesmo item: só um grava.
   */
  insertRankingFind(tenantId: string, find: NewOfferHuntFind & { runId: string; huntId: string }, repeatSince: Date): Promise<RankingFindInsert>;
  /** Ids de produto com achado (fora FAILED/DISMISSED) nesta execução (escolhidos ou reaproveitados): "enviado". */
  productIdsByRun(tenantId: string, runId: string): Promise<string[]>;
  /** Achados do teto do dia: sem os reaproveitados do ranking (`fromRanking`). */
  countCreatedSince(tenantId: string, since: Date): Promise<number>;
  /**
   * Ids de produto da marca já escolhidos pela caçada desde `since` (qualquer estado): regra de repetição.
   * `exceptUndeliveredInRun`: ignora o FAILED/DISMISSED dessa execução (reenvio do ranking).
   */
  recentProductIds(
    tenantId: string, huntId: string, provider: HuntProvider, since: Date, opts?: { exceptUndeliveredInRun?: string },
  ): Promise<Set<string>>;
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
   * Claim do reenvio, atômico e serializado por tenant (lock + teto diário no mesmo passo):
   * - oferta atual ≠ `offerId` ou reenvio em voo (`resendInFlightUntil > now`) → `PENDING`;
   * - reenvio interrompido (em voo vencido, oferta não trocada) → retoma com o MESMO número (não conta no teto);
   * - senão exige `lastResentAt < now − cooldownMs` (`PENDING`) e saldo no teto do dia (`DAILY_LIMIT`);
   *   conta 1 reenvio no dia, `resendCount + 1`.
   * Em todo claim aceito: `lastResentAt = now`, `resendInFlightUntil = now + inFlightMs`.
   */
  claimResend(tenantId: string, id: string, offerId: string, now: Date, opts: ResendClaimOptions): Promise<ResendClaim>;
  /** Falha antes de trocar a oferta: em voo vence já (próximo clique retoma o mesmo número). */
  releaseResend(tenantId: string, id: string, number: number, now: Date): Promise<void>;
  /** Reenvio `number` enfileirado: troca `offerId`, achado `SENT`, fim do em voo. Idempotente. */
  recordResend(tenantId: string, id: string, offerId: string, number: number): Promise<void>;
  /** Reenvios contados no dia que começa em `dayStart` (teto diário). */
  countResendsInDay(tenantId: string, dayStart: Date): Promise<number>;
}
