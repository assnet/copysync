import type { SaverExtraction, SaverExtractionItem } from '../entities/SaverEntities';
import type { SaverExtractionItemStatus, SaverExtractionTrigger } from '../enums/SaverEnums';

export interface EnqueueSaverExtractionInput {
  tenantId: string;
  sessionId: string;
  requestedByUserId: string | null;
  trigger: SaverExtractionTrigger;
  /** Grupos já gravados/reativados; pendentes são ignorados (índice único parcial). */
  groupIds: readonly string[];
  now: Date;
}

export interface ReleaseSaverItemInput {
  itemId: string;
  status: SaverExtractionItemStatus;
  attempts: number;
  nextAttemptAt: Date;
  errorCode: string | null;
  finishedAt: Date | null;
  /** Somados à extração (`membersFound`, `newContacts`); DONE/FAILED também somam em `doneGroups`/`failedGroups`. */
  membersFound?: number;
  newContacts?: number;
}

export interface ISaverExtractionQueue {
  enqueue(input: EnqueueSaverExtractionInput): Promise<SaverExtraction>;
  /** 1 item da sessão (`SKIP LOCKED`), marca RUNNING com trava até `lockUntil`; trava vencida volta a concorrer. */
  claimNext(sessionId: string, now: Date, lockUntil: Date): Promise<SaverExtractionItem | null>;
  /** Grava o desfecho do item; fecha a extração se não restar item pendente. */
  release(input: ReleaseSaverItemInput): Promise<void>;
  findExtraction(tenantId: string, extractionId: string): Promise<SaverExtraction | null>;
  /** Cancela itens QUEUED da extração; devolve quantos. */
  cancelQueued(tenantId: string, extractionId: string, now: Date): Promise<number>;
  cancelPendingByGroup(tenantId: string, groupId: string, now: Date): Promise<number>;
  cancelPendingByTenant(tenantId: string, now: Date): Promise<number>;
  /** Leituras em 24 h corridas (limite `saver_group_scans_per_day`). */
  countScansSince(tenantId: string, since: Date): Promise<number>;
  /** Cancela itens QUEUED/RUNNING de sessão com `deletedAt` (exclusão lógica); devolve quantos. */
  cancelPendingForDeletedSessions(now: Date): Promise<number>;
  /** Fecha extrações sem item pendente (DONE/PARTIAL/FAILED/CANCELLED); devolve quantas. */
  closeFinished(now: Date): Promise<number>;
}
