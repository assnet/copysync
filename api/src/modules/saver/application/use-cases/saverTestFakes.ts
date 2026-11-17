import type { ISaverExtractionQueue, ReleaseSaverItemInput, SaverItemClaim } from '../../domain/contracts/ISaverExtractionQueue';
import type { ISaverSessionStateStore } from '../../domain/contracts/ISaverSessionStateStore';
import type { ISaverGroupRepository, SaverGroupScanInput } from '../../domain/contracts/ISaverGroupRepository';
import type { ISaverMembershipRepository } from '../../domain/contracts/ISaverMembershipRepository';
import type {
  ApplyGroupReadOutcome,
  IPlatformSaverContactRepository,
  SaverContactUsage,
} from '../../domain/contracts/IPlatformSaverContactRepository';
import type { PlatformSaverContact, SaverExtraction, SaverExtractionItem, SaverGroup } from '../../domain/entities/SaverEntities';
import { SaverExtractionItemStatus, SaverExtractionStatus, SaverExtractionTrigger } from '../../domain/enums/SaverEnums';
import type { MergeGroupReadResult, SaverReadMember } from '../../domain/services/mergeGroupRead';
import type { ProcessNextSaverItemDeps } from './ProcessNextSaverItemUseCase';

/** Fakes em memória dos contratos do Saver para testes de use case (sem banco). */

/** Hora padrão do pedido nos fakes (o `NOW` dos testes do passo). */
export const FAKE_ITEM_CREATED_AT = new Date('2026-11-17T12:00:00.000Z');

const PENDING = new Set<string>([SaverExtractionItemStatus.QUEUED, SaverExtractionItemStatus.RUNNING]);

export class FakeSaverQueue implements ISaverExtractionQueue {
  items: SaverExtractionItem[] = [];
  extractions: SaverExtraction[] = [];
  releases: ReleaseSaverItemInput[] = [];
  /** Sessões com `deletedAt` (exclusão lógica). */
  deletedSessions = new Set<string>();
  /** Usuários super admin (para `requestedBySuperAdmin`). */
  superAdmins = new Set<string>();

  addItem(
    partial: Partial<SaverExtractionItem> & Pick<SaverExtractionItem, 'id' | 'sessionId' | 'tenantId' | 'groupId'>,
    requestedByUserId: string | null = null,
  ): SaverExtractionItem {
    const extractionId = partial.extractionId ?? 'ext-1';
    if (!this.extractions.some((e) => e.id === extractionId)) {
      this.extractions.push({
        id: extractionId, tenantId: partial.tenantId, sessionId: partial.sessionId, requestedByUserId,
        trigger: SaverExtractionTrigger.MANUAL, status: SaverExtractionStatus.QUEUED, totalGroups: 0, doneGroups: 0,
        failedGroups: 0, membersFound: 0, newContacts: 0, createdAt: new Date(0), finishedAt: null,
      });
    }
    const item: SaverExtractionItem = {
      extractionId, status: SaverExtractionItemStatus.QUEUED, attempts: 0, nextAttemptAt: new Date(0),
      lockedUntil: null, errorCode: null, finishedAt: null, createdAt: FAKE_ITEM_CREATED_AT, ...partial,
    };
    this.extractions.find((e) => e.id === extractionId)!.totalGroups += 1;
    this.items.push(item);
    return item;
  }

  async enqueue(): Promise<SaverExtraction> {
    throw new Error('not used');
  }

  async requestGroups(): Promise<SaverExtraction> {
    throw new Error('not used');
  }

  async claimNext(sessionId: string, now: Date, lockUntil: Date): Promise<SaverExtractionItem | null> {
    if (this.deletedSessions.has(sessionId)) return null;
    const item = this.items.find(
      (i) =>
        i.sessionId === sessionId &&
        ((i.status === SaverExtractionItemStatus.QUEUED && i.nextAttemptAt <= now) ||
          (i.status === SaverExtractionItemStatus.RUNNING && (!i.lockedUntil || i.lockedUntil <= now))),
    );
    if (!item) return null;
    item.status = SaverExtractionItemStatus.RUNNING;
    item.lockedUntil = lockUntil;
    return { ...item };
  }

  /** Mesma posse do SQL: item `RUNNING` com o `lockedUntil` do claim. */
  owns(itemId: string, lockedUntil: Date | null): boolean {
    const item = this.items.find((i) => i.id === itemId);
    return !!item && item.status === SaverExtractionItemStatus.RUNNING && item.lockedUntil?.getTime() === lockedUntil?.getTime();
  }

  async release(input: ReleaseSaverItemInput): Promise<boolean> {
    this.releases.push(input);
    if (!this.owns(input.itemId, input.claimedLockUntil)) return false;
    const item = this.items.find((i) => i.id === input.itemId)!;
    Object.assign(item, {
      status: input.status, attempts: input.attempts, nextAttemptAt: input.nextAttemptAt,
      errorCode: input.errorCode, finishedAt: input.finishedAt, lockedUntil: null,
    });
    const ext = this.extractions.find((e) => e.id === item.extractionId)!;
    ext.membersFound += input.membersFound ?? 0;
    ext.newContacts += input.newContacts ?? 0;
    if (input.status === SaverExtractionItemStatus.DONE) ext.doneGroups += 1;
    if (input.status === SaverExtractionItemStatus.FAILED) ext.failedGroups += 1;
    this.close(input.finishedAt ?? input.nextAttemptAt);
    return true;
  }

  async findExtraction(tenantId: string, id: string): Promise<SaverExtraction | null> {
    return this.extractions.find((e) => e.id === id && e.tenantId === tenantId) ?? null;
  }

  async cancelQueued(): Promise<number> {
    throw new Error('not used');
  }

  async cancelPendingByGroup(tenantId: string, groupId: string, now: Date): Promise<number> {
    return this.cancelWhere((i) => i.tenantId === tenantId && i.groupId === groupId, now);
  }

  async cancelPendingByTenant(tenantId: string, now: Date): Promise<number> {
    return this.cancelWhere((i) => i.tenantId === tenantId && !this.bySuperAdmin(i.extractionId), now);
  }

  async requestedBySuperAdmin(extractionId: string): Promise<boolean> {
    return this.bySuperAdmin(extractionId);
  }

  private bySuperAdmin(extractionId: string): boolean {
    const by = this.extractions.find((e) => e.id === extractionId)?.requestedByUserId;
    return !!by && this.superAdmins.has(by);
  }

  async countScansSince(): Promise<number> {
    return 0;
  }

  async cancelPendingForDeletedSessions(now: Date): Promise<number> {
    return this.cancelWhere((i) => this.deletedSessions.has(i.sessionId), now);
  }

  async closeFinished(now: Date): Promise<number> {
    return this.close(now);
  }

  private cancelWhere(match: (i: SaverExtractionItem) => boolean, now: Date): number {
    let n = 0;
    for (const i of this.items) {
      if (!PENDING.has(i.status) || !match(i)) continue;
      Object.assign(i, { status: SaverExtractionItemStatus.CANCELLED, finishedAt: now, lockedUntil: null });
      n += 1;
    }
    if (n > 0) this.close(now);
    return n;
  }

  /** Mesma regra do SQL de `closeExtractions`. */
  private close(now: Date): number {
    let closed = 0;
    for (const e of this.extractions) {
      if (e.status !== SaverExtractionStatus.QUEUED && e.status !== SaverExtractionStatus.RUNNING) continue;
      const items = this.items.filter((i) => i.extractionId === e.id);
      if (items.some((i) => PENDING.has(i.status))) continue;
      const done = items.filter((i) => i.status === SaverExtractionItemStatus.DONE).length;
      const failed = items.filter((i) => i.status === SaverExtractionItemStatus.FAILED).length;
      e.status =
        done === items.length && items.length > 0 ? SaverExtractionStatus.DONE
          : done > 0 ? SaverExtractionStatus.PARTIAL
            : failed > 0 ? SaverExtractionStatus.FAILED
              : SaverExtractionStatus.CANCELLED;
      e.finishedAt = now;
      closed += 1;
    }
    return closed;
  }
}

export class FakeSaverSessionStates implements ISaverSessionStateStore {
  owned: string[] = [];
  states = new Map<string, { tenantId: string; nextScanAt: Date; pausedUntil: Date | null; pauseReason: string | null }>();

  async ownedSessionIds(): Promise<string[]> {
    return [...this.owned];
  }

  async dueSessions(ids: readonly string[], now: Date): Promise<string[]> {
    return ids.filter((id) => {
      const s = this.states.get(id);
      return !s || (s.nextScanAt <= now && (!s.pausedUntil || s.pausedUntil <= now));
    });
  }

  async scheduleNext(sessionId: string, tenantId: string, nextScanAt: Date): Promise<void> {
    const s = this.states.get(sessionId);
    this.states.set(sessionId, { tenantId, pausedUntil: null, pauseReason: null, ...s, nextScanAt });
  }

  async pause(sessionId: string, tenantId: string, until: Date, reason: string): Promise<void> {
    const s = this.states.get(sessionId);
    this.states.set(sessionId, { tenantId, nextScanAt: until, ...s, pausedUntil: until, pauseReason: reason });
  }
}

export class FakeSaverGroups implements ISaverGroupRepository {
  groups: SaverGroup[] = [];
  scans: { groupId: string; scan: SaverGroupScanInput }[] = [];

  add(id: string, tenantId: string, removedAt: Date | null = null): SaverGroup {
    const g: SaverGroup = {
      id, tenantId, sessionId: null, groupJid: `${id}@g.us`, name: id, memberCount: 0, phoneCount: 0,
      lidOnlyCount: 0, lastScannedAt: null, lastScanStatus: null, createdAt: new Date(0), removedAt,
    };
    this.groups.push(g);
    return g;
  }

  async listActive(tenantId: string): Promise<SaverGroup[]> {
    return this.groups.filter((g) => g.tenantId === tenantId && !g.removedAt);
  }
  async findById(tenantId: string, id: string): Promise<SaverGroup | null> {
    return this.groups.find((g) => g.tenantId === tenantId && g.id === id) ?? null;
  }
  async findByJids(): Promise<SaverGroup[]> {
    return [];
  }
  async upsertMany(): Promise<SaverGroup[]> {
    return [];
  }
  async recordScan(tenantId: string, groupId: string, scan: SaverGroupScanInput): Promise<void> {
    if (this.groups.find((g) => g.tenantId === tenantId && g.id === groupId)?.removedAt) return;
    this.scans.push({ groupId, scan });
  }
  async countActive(tenantId: string): Promise<number> {
    return (await this.listActive(tenantId)).length;
  }
  async markRemoved(tenantId: string, groupId: string, at: Date): Promise<void> {
    const g = this.groups.find((x) => x.tenantId === tenantId && x.id === groupId && !x.removedAt);
    if (g) g.removedAt = at;
  }
}

/**
 * Base da plataforma + vínculos em memória, coerentes entre si: `applyGroupRead` cria contatos e vínculos
 * e as contagens de `memberships` leem o mesmo estado.
 */
export class FakeSaverStore {
  contacts: PlatformSaverContact[] = [];
  /** tenantId × groupId × contactId */
  links: { tenantId: string; groupId: string; contactId: string; leftAt: Date | null }[] = [];
  applied = 0;
  /** Erro lançado no próximo `applyGroupRead` (simula corrida). */
  applyError: Error | null = null;
  private seq = 0;

  constructor(
    private readonly groups: FakeSaverGroups,
    private readonly queue: FakeSaverQueue,
  ) {}

  readonly platformContacts: IPlatformSaverContactRepository = {
    findByKeys: async (phones, lids) =>
      this.contacts.filter((c) => (c.phone && phones.includes(c.phone)) || (c.lid && lids.includes(c.lid))),
    list: async () => [],
    findLinks: async () => [],
    listTenants: async () => [],
    applyGroupRead: async (
      tenantId: string,
      groupId: string,
      result: MergeGroupReadResult,
      claim: SaverItemClaim,
      fitsContacts: (usage: SaverContactUsage) => boolean,
    ): Promise<ApplyGroupReadOutcome> => {
      if (this.applyError) {
        const err = this.applyError;
        this.applyError = null;
        throw err;
      }
      const group = this.groups.groups.find((g) => g.tenantId === tenantId && g.id === groupId);
      if (!this.queue.owns(claim.itemId, claim.lockedUntil) || group?.removedAt) return { status: 'CLAIM_LOST' };
      const existingIds = [...new Set(result.membershipUpserts.flatMap((m) => ('existingId' in m.contact ? [m.contact.existingId] : [])))];
      const used = await this.memberships.countDistinctContacts(tenantId);
      const firstLinks = await this.memberships.countContactsWithoutTenantLink(tenantId, existingIds);
      if (!fitsContacts({ used, adding: firstLinks + result.contactInserts.length })) return { status: 'LIMIT_REACHED' };
      this.applied += 1;
      const insertedIds = result.contactInserts.map((c) => {
        const id = `c${++this.seq}`;
        this.contacts.push({ id, ...c });
        return id;
      });
      for (const m of result.membershipUpserts) {
        const contactId = 'existingId' in m.contact ? m.contact.existingId : insertedIds[m.contact.newIndex]!;
        const link = this.links.find((l) => l.groupId === groupId && l.contactId === contactId);
        if (link) link.leftAt = null;
        else this.links.push({ tenantId, groupId, contactId, leftAt: null });
      }
      return { status: 'APPLIED', insertedIds, created: insertedIds.length };
    },
  };

  readonly memberships: ISaverMembershipRepository = {
    listGroupMemberships: async (tenantId, groupId) =>
      this.links
        .filter((l) => l.tenantId === tenantId && l.groupId === groupId)
        .map((l) => ({ contactId: l.contactId, name: null, isAdmin: false, firstExtractedAt: new Date(0), lastExtractedAt: new Date(0), leftAt: l.leftAt })),
    countDistinctContacts: async (tenantId) => new Set(this.activeLinks(tenantId).map((l) => l.contactId)).size,
    countContactsWithoutTenantLink: async (tenantId, ids) => {
      const linked = new Set(this.activeLinks(tenantId).map((l) => l.contactId));
      return new Set(ids.filter((id) => !linked.has(id))).size;
    },
    countForExport: async () => ({ total: 0, withPhone: 0, lidOnly: 0 }),
    exportBatches: async function* () {},
  };

  private activeLinks(tenantId: string) {
    const live = new Set(this.groups.groups.filter((g) => g.tenantId === tenantId && !g.removedAt).map((g) => g.id));
    return this.links.filter((l) => l.tenantId === tenantId && live.has(l.groupId));
  }
}

export interface SaverStepHarness {
  deps: ProcessNextSaverItemDeps;
  queue: FakeSaverQueue;
  states: FakeSaverSessionStates;
  groups: FakeSaverGroups;
  store: FakeSaverStore;
  /** Membros devolvidos por `groupJid`; `Error` = engine lança. */
  reads: Map<string, SaverReadMember[] | Error>;
  engineCalls: { sessionId: string; groupJid: string }[];
  /** Roda durante a leitura do engine (simula remoção/cancelamento concorrente). */
  duringRead: (() => Promise<void>) | null;
  /** Tenants com produto SAVER ativo; `Error` = leitura do acesso falha. */
  activeTenants: Set<string>;
  productError: Error | null;
  entitlements: Map<string, Record<string, unknown>>;
}

export function makeSaverStepHarness(random: () => number = () => 0): SaverStepHarness {
  const queue = new FakeSaverQueue();
  const states = new FakeSaverSessionStates();
  const groups = new FakeSaverGroups();
  const store = new FakeSaverStore(groups, queue);
  const h: SaverStepHarness = {
    queue, states, groups, store,
    reads: new Map(),
    engineCalls: [],
    duringRead: null,
    activeTenants: new Set(),
    productError: null,
    entitlements: new Map(),
    deps: undefined as unknown as ProcessNextSaverItemDeps,
  };
  h.deps = {
    queue, sessionStates: states, groups,
    memberships: store.memberships,
    platformContacts: store.platformContacts,
    engine: {
      getGroupMembers: async (sessionId, groupJid) => {
        h.engineCalls.push({ sessionId, groupJid });
        if (h.duringRead) await h.duringRead();
        const read = h.reads.get(groupJid) ?? [];
        if (read instanceof Error) throw read;
        return read;
      },
    },
    products: {
      has: async (tenantId) => {
        if (h.productError) throw h.productError;
        return h.activeTenants.has(tenantId);
      },
    },
    entitlements: { readAll: async (tenantId) => h.entitlements.get(tenantId) ?? {} },
    random,
  };
  return h;
}

export const member = (phone: string | null, lid: string | null = null, name: string | null = null): SaverReadMember => ({
  phone, lid, name, isAdmin: false,
});
