import type { ISaverExtractionQueue, ReleaseSaverItemInput } from '../../domain/contracts/ISaverExtractionQueue';
import type { ISaverSessionStateStore } from '../../domain/contracts/ISaverSessionStateStore';
import type { ISaverGroupRepository } from '../../domain/contracts/ISaverGroupRepository';
import type { ISaverMembershipRepository } from '../../domain/contracts/ISaverMembershipRepository';
import type { IPlatformSaverContactRepository } from '../../domain/contracts/IPlatformSaverContactRepository';
import type { SaverExtractionItem } from '../../domain/entities/SaverEntities';
import { SaverExtractionItemStatus } from '../../domain/enums/SaverEnums';
import {
  mergeGroupRead,
  normalizeLid,
  normalizePhone,
  type MergeGroupReadResult,
  type SaverReadMember,
} from '../../domain/services/mergeGroupRead';
import { fitsSaverLimit, readSaverLimit, SAVER_LIMIT_KEYS } from '../../domain/services/saverLimits';
import type { IProductAccessReader } from '../../../tenants/domain/contracts/IProductAccessReader';
import type { IEntitlementSnapshotReader } from '../../../tenants/domain/contracts/IEntitlementSnapshotReader';
import { AppError } from '../../../../shared/errors/AppError';

/** Ritmo por sessão: 1 grupo a cada 3–5 s (sorteio), design.md §4.3. */
export const SAVER_SCAN_MIN_GAP_MS = 3_000;
export const SAVER_SCAN_MAX_GAP_MS = 5_000;
/** Trava do item em execução; vencida, o item volta a concorrer. */
export const SAVER_ITEM_LOCK_MS = 60_000;
/** Sessão desconectada: item volta sem contar tentativa. */
export const SAVER_DISCONNECTED_RETRY_MS = 60_000;
/** Limite de taxa ou engine indisponível: pausa da sessão no Saver. */
export const SAVER_PAUSE_MS = 15 * 60_000;
/** Corrida perdida com outra gravação (outro tenant): repete logo, sem contar tentativa. */
export const SAVER_CONFLICT_RETRY_MS = 5_000;
export const SAVER_MAX_ATTEMPTS = 3;
export const SAVER_BACKOFF_BASE_MS = 30_000;

/** Motivos gravados em `errorCode`/`pauseReason` (nunca texto cru do engine). */
export const SAVER_ITEM_ERRORS = {
  RATE_LIMITED: 'ENGINE_RATE_LIMITED',
  UNAVAILABLE: 'ENGINE_TEMPORARILY_UNAVAILABLE',
  PLAN_LIMIT: 'PLAN_LIMIT_REACHED',
  GROUP_REMOVED: 'GROUP_REMOVED',
  PRODUCT_INACTIVE: 'PRODUCT_UNAVAILABLE',
} as const;

const DISCONNECTED_CODES = new Set(['SESSION_NOT_CONNECTED', 'SESSION_NOT_FOUND', 'SESSION_EXPIRED']);
/** Grupo inexistente, sem acesso ou canal sem a operação: falha definitiva. */
const DEFINITIVE_CODES = new Set(['NOT_FOUND', 'ENGINE_OPERATION_UNSUPPORTED', 'FORBIDDEN']);

export interface SaverGroupMembersReader {
  getGroupMembers(sessionId: string, groupJid: string): Promise<SaverReadMember[]>;
}

export interface ProcessNextSaverItemDeps {
  queue: ISaverExtractionQueue;
  sessionStates: ISaverSessionStateStore;
  groups: ISaverGroupRepository;
  memberships: ISaverMembershipRepository;
  platformContacts: IPlatformSaverContactRepository;
  engine: SaverGroupMembersReader;
  products: Pick<IProductAccessReader, 'has'>;
  entitlements: IEntitlementSnapshotReader;
  /** [0, 1); injetado nos testes. */
  random?: () => number;
}

export interface ProcessNextSaverItemInput {
  /** Sessões com lease vivo deste processo (`ISaverSessionStateStore.ownedSessionIds`). */
  localSessionIds: readonly string[];
  now: Date;
}

export type SaverItemOutcome =
  | 'DONE'
  | 'FAILED'
  | 'RETRY'
  | 'DISCONNECTED'
  | 'PAUSED'
  | 'CONFLICT'
  | 'CANCELLED'
  | 'PRODUCT_INACTIVE';

export interface ProcessNextSaverItemResult {
  processed: number;
  outcomes: { sessionId: string; itemId: string; outcome: SaverItemOutcome }[];
  /** Sessões cujo passo lançou (falha de banco): o job registra e segue. */
  errors: { sessionId: string; code: string }[];
}

/**
 * Passo do job de extração (design.md §4.3): por sessão devida, pega 1 item, lê os membros do grupo,
 * funde com a base da plataforma, confere o teto `saver_contacts` e grava tudo ou nada. Nunca processa
 * sessão fora de `localSessionIds`; nunca lança por item (o desfecho vai para a fila).
 */
export class ProcessNextSaverItemUseCase {
  private readonly random: () => number;

  constructor(private readonly deps: ProcessNextSaverItemDeps) {
    this.random = deps.random ?? Math.random;
  }

  async execute({ localSessionIds, now }: ProcessNextSaverItemInput): Promise<ProcessNextSaverItemResult> {
    const result: ProcessNextSaverItemResult = { processed: 0, outcomes: [], errors: [] };
    if (localSessionIds.length === 0) return result;
    const local = new Set(localSessionIds);
    const due = (await this.deps.sessionStates.dueSessions(localSessionIds, now)).filter((id) => local.has(id));
    for (const sessionId of due) {
      try {
        const item = await this.deps.queue.claimNext(sessionId, now, new Date(now.getTime() + SAVER_ITEM_LOCK_MS));
        if (!item) continue;
        const outcome = await this.processItem(item, now);
        await this.deps.sessionStates.scheduleNext(sessionId, item.tenantId, new Date(now.getTime() + this.gapMs()));
        result.processed += 1;
        result.outcomes.push({ sessionId, itemId: item.id, outcome });
      } catch (err) {
        result.errors.push({ sessionId, code: err instanceof AppError ? err.code : 'UNEXPECTED' });
      }
    }
    return result;
  }

  private gapMs(): number {
    const r = Math.min(Math.max(this.random(), 0), 0.999_999);
    return SAVER_SCAN_MIN_GAP_MS + Math.floor(r * (SAVER_SCAN_MAX_GAP_MS - SAVER_SCAN_MIN_GAP_MS + 1));
  }

  private async processItem(item: SaverExtractionItem, now: Date): Promise<SaverItemOutcome> {
    const { queue } = this.deps;
    let active: boolean;
    try {
      // SAVER-47: super admin pilota no próprio tenant sem plano; o pedido dele processa sem o produto.
      active =
        (await this.deps.products.has(item.tenantId, 'SAVER')) ||
        (await queue.requestedBySuperAdmin(item.extractionId));
    } catch {
      // Leitura do acesso falhou: não decide nada, devolve sem contar tentativa.
      await this.requeue(item, now, SAVER_DISCONNECTED_RETRY_MS, item.attempts, null);
      return 'RETRY';
    }
    if (!active) {
      // Cancela os pendentes do tenant, menos pedidos de super admin (esses seguem pela regra acima).
      await queue.cancelPendingByTenant(item.tenantId, now);
      return 'PRODUCT_INACTIVE';
    }

    const group = await this.deps.groups.findById(item.tenantId, item.groupId);
    if (!group || group.removedAt) {
      await this.finish(item, now, SaverExtractionItemStatus.CANCELLED, SAVER_ITEM_ERRORS.GROUP_REMOVED);
      return 'CANCELLED';
    }

    try {
      const members = await this.deps.engine.getGroupMembers(item.sessionId, group.groupJid);
      return await this.store(item, group.id, members, now);
    } catch (err) {
      return this.handleError(item, now, err);
    }
  }

  private async store(
    item: SaverExtractionItem,
    groupId: string,
    members: SaverReadMember[],
    now: Date,
  ): Promise<SaverItemOutcome> {
    const { platformContacts, memberships, groups } = this.deps;
    const phones = uniq(members.map((m) => normalizePhone(m.phone)));
    const lids = uniq(members.map((m) => normalizeLid(m.lid)));
    const [contacts, current] = await Promise.all([
      platformContacts.findByKeys(phones, lids),
      memberships.listGroupMemberships(item.tenantId, groupId),
    ]);
    const merged = mergeGroupRead({ contacts, memberships: current, members, now, extractionId: item.extractionId });

    if (!(await this.fitsContactLimit(item.tenantId, merged))) {
      await groups.recordScan(item.tenantId, groupId, { sessionId: item.sessionId, status: SaverExtractionItemStatus.FAILED, at: now });
      await this.finish(item, now, SaverExtractionItemStatus.FAILED, SAVER_ITEM_ERRORS.PLAN_LIMIT);
      return 'FAILED';
    }

    // Claim perdido durante a leitura (grupo removido, extração cancelada, trava retomada): nada é gravado,
    // nem vínculo, nem varredura, nem desfecho; o status de quem cancelou prevalece.
    const applied = await platformContacts.applyGroupRead(item.tenantId, groupId, merged, {
      itemId: item.id,
      lockedUntil: item.lockedUntil,
    });
    if (!applied) return 'CANCELLED';
    const counts = countMembers(members);
    await groups.recordScan(item.tenantId, groupId, {
      sessionId: item.sessionId,
      status: SaverExtractionItemStatus.DONE,
      at: now,
      ...counts,
    });
    await this.deps.queue.release({
      itemId: item.id,
      claimedLockUntil: item.lockedUntil,
      status: SaverExtractionItemStatus.DONE,
      attempts: item.attempts,
      nextAttemptAt: now,
      errorCode: null,
      finishedAt: now,
      membersFound: merged.membersRead,
      newContacts: applied.created,
    });
    return 'DONE';
  }

  /**
   * Teto = contatos DISTINTOS vinculados ao tenant. Já vinculado não consome; contato que já está na base
   * (por outro tenant) consome ao ganhar o primeiro vínculo deste tenant; insert novo sempre consome.
   */
  private async fitsContactLimit(tenantId: string, merged: MergeGroupReadResult): Promise<boolean> {
    const limit = readSaverLimit(await this.deps.entitlements.readAll(tenantId), SAVER_LIMIT_KEYS.CONTACTS);
    if (limit === null) return true;
    const existingIds = uniq(
      merged.membershipUpserts.map((m) => ('existingId' in m.contact ? m.contact.existingId : null)),
    );
    const [used, firstLinks] = await Promise.all([
      this.deps.memberships.countDistinctContacts(tenantId),
      this.deps.memberships.countContactsWithoutTenantLink(tenantId, existingIds),
    ]);
    return fitsSaverLimit(limit, used, firstLinks + merged.contactInserts.length);
  }

  private async handleError(item: SaverExtractionItem, now: Date, err: unknown): Promise<SaverItemOutcome> {
    const code = err instanceof AppError ? err.code : null;
    if (code && DISCONNECTED_CODES.has(code)) {
      await this.requeue(item, now, SAVER_DISCONNECTED_RETRY_MS, item.attempts, null);
      return 'DISCONNECTED';
    }
    if (code === 'ENGINE_RATE_LIMITED' || code === 'ENGINE_TEMPORARILY_UNAVAILABLE') {
      const until = new Date(now.getTime() + SAVER_PAUSE_MS);
      await this.deps.sessionStates.pause(item.sessionId, item.tenantId, until, code);
      // Limite de taxa não conta tentativa. Indisponível conta: o engine também devolve isso para
      // grupo inacessível, e sem teto o item pausaria a sessão para sempre.
      const rateLimited = code === 'ENGINE_RATE_LIMITED';
      const attempts = rateLimited ? item.attempts : item.attempts + 1;
      if (!rateLimited && attempts >= SAVER_MAX_ATTEMPTS) return this.fail(item, now, code, attempts);
      await this.requeue(item, now, SAVER_PAUSE_MS, attempts, code);
      return 'PAUSED';
    }
    if (code === 'CONCURRENT_WRITE_CONFLICT') {
      await this.requeue(item, now, SAVER_CONFLICT_RETRY_MS, item.attempts, code);
      return 'CONFLICT';
    }
    const errorCode = code ?? 'UNEXPECTED';
    if (code && DEFINITIVE_CODES.has(code)) return this.fail(item, now, errorCode, item.attempts + 1);
    const attempts = item.attempts + 1;
    if (attempts >= SAVER_MAX_ATTEMPTS) return this.fail(item, now, errorCode, attempts);
    await this.requeue(item, now, SAVER_BACKOFF_BASE_MS * 2 ** attempts, attempts, errorCode);
    return 'RETRY';
  }

  private async fail(item: SaverExtractionItem, now: Date, errorCode: string, attempts: number): Promise<SaverItemOutcome> {
    await this.deps.groups.recordScan(item.tenantId, item.groupId, {
      sessionId: item.sessionId,
      status: SaverExtractionItemStatus.FAILED,
      at: now,
    });
    await this.finish(item, now, SaverExtractionItemStatus.FAILED, errorCode, attempts);
    return 'FAILED';
  }

  private finish(
    item: SaverExtractionItem,
    now: Date,
    status: SaverExtractionItemStatus,
    errorCode: string | null,
    attempts = item.attempts,
  ): Promise<void> {
    return this.release(item, { status, attempts, nextAttemptAt: now, errorCode, finishedAt: now });
  }

  private requeue(item: SaverExtractionItem, now: Date, delayMs: number, attempts: number, errorCode: string | null): Promise<void> {
    return this.release(item, {
      status: SaverExtractionItemStatus.QUEUED,
      attempts,
      nextAttemptAt: new Date(now.getTime() + delayMs),
      errorCode,
      finishedAt: null,
    });
  }

  /** Desfecho só do dono do claim; cancelado no meio do caminho fica cancelado. */
  private async release(
    item: SaverExtractionItem,
    outcome: Omit<ReleaseSaverItemInput, 'itemId' | 'claimedLockUntil'>,
  ): Promise<void> {
    await this.deps.queue.release({ itemId: item.id, claimedLockUntil: item.lockedUntil, ...outcome });
  }
}

function uniq(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

/** Contadores da tela (nunca linhas): membros, com número, só LID. */
function countMembers(members: readonly SaverReadMember[]): { memberCount: number; phoneCount: number; lidOnlyCount: number } {
  let phoneCount = 0;
  let lidOnlyCount = 0;
  for (const m of members) {
    if (normalizePhone(m.phone)) phoneCount += 1;
    else if (normalizeLid(m.lid)) lidOnlyCount += 1;
  }
  return { memberCount: members.length, phoneCount, lidOnlyCount };
}
