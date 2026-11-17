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

export interface SaverRequestGroupInput {
  groupJid: string;
  /** Nome do engine; vazio mantém o salvo (ou o JID, se novo). */
  name: string | null;
}

export interface RequestSaverGroupsInput {
  tenantId: string;
  sessionId: string;
  requestedByUserId: string | null;
  groups: readonly SaverRequestGroupInput[];
  /** Início da janela de `saver_group_scans_per_day`. */
  scansSince: Date;
  now: Date;
}

/** Uso lido sob a trava do tenant, entregue ao `guard` antes de gravar. */
export interface SaverRequestUsage {
  /** Grupos ativos do tenant. */
  activeCount: number;
  /** Dos grupos pedidos, quantos já estão salvos e ativos (não consomem `saver_groups`). */
  activeRequested: number;
  /** Leituras na janela (itens não cancelados). */
  scansUsed: number;
}

/**
 * Posse do item pega por `claimNext`: o `lockedUntil` gravado no claim é o token. Item cancelado (grupo
 * removido, extração cancelada) ou retomado por outro claim (trava vencida) não bate mais.
 */
export interface SaverItemClaim {
  itemId: string;
  lockedUntil: Date | null;
}

export interface ReleaseSaverItemInput {
  itemId: string;
  /** Token do claim (`SaverExtractionItem.lockedUntil` devolvido por `claimNext`). */
  claimedLockUntil: Date | null;
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
  /**
   * Pedido atômico (SAVER-09/10): numa transação sob a trava do tenant lê o uso, chama `guard` (que lança
   * para barrar; nada é gravado), salva/reativa os grupos e enfileira. Pedidos simultâneos não passam do teto.
   */
  requestGroups(input: RequestSaverGroupsInput, guard: (usage: SaverRequestUsage) => void): Promise<SaverExtraction>;
  /** 1 item da sessão (`SKIP LOCKED`), marca RUNNING com trava até `lockUntil`; trava vencida volta a concorrer. */
  claimNext(sessionId: string, now: Date, lockUntil: Date): Promise<SaverExtractionItem | null>;
  /**
   * Grava o desfecho só se o item ainda é deste claim (`RUNNING` + mesmo `lockedUntil`); fecha a extração se
   * não restar item pendente. Devolve `false` (nada gravado, contadores intactos) se o claim foi perdido.
   */
  release(input: ReleaseSaverItemInput): Promise<boolean>;
  findExtraction(tenantId: string, extractionId: string): Promise<SaverExtraction | null>;
  /** Cancela itens QUEUED da extração; devolve quantos. */
  cancelQueued(tenantId: string, extractionId: string, now: Date): Promise<number>;
  cancelPendingByGroup(tenantId: string, groupId: string, now: Date): Promise<number>;
  /**
   * Tenant sem produto SAVER: cancela os pendentes, menos os de extração pedida por super admin (piloto no
   * próprio tenant sem plano, SAVER-47).
   */
  cancelPendingByTenant(tenantId: string, now: Date): Promise<number>;
  /** A extração foi pedida por usuário hoje super admin (`users.isSuperAdmin`, lido a cada chamada). */
  requestedBySuperAdmin(extractionId: string): Promise<boolean>;
  /** Leituras em 24 h corridas (limite `saver_group_scans_per_day`). */
  countScansSince(tenantId: string, since: Date): Promise<number>;
  /** Cancela itens QUEUED/RUNNING de sessão com `deletedAt` (exclusão lógica); devolve quantos. */
  cancelPendingForDeletedSessions(now: Date): Promise<number>;
  /** Fecha extrações sem item pendente (DONE/PARTIAL/FAILED/CANCELLED); devolve quantas. */
  closeFinished(now: Date): Promise<number>;
}
