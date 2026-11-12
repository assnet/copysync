// Fakes em memória do Caçador de Ofertas — só para testes dos use cases.
import type { IOfferHuntRepository, OfferHuntPatch } from '../../../domain/contracts/hunter/IOfferHuntRepository';
import type { IOfferHuntRunRepository, FinishOfferHuntRunInput, StartOfferHuntRunInput } from '../../../domain/contracts/hunter/IOfferHuntRunRepository';
import type { IOfferHuntFindRepository, NewOfferHuntFind, OfferHuntFindTransition } from '../../../domain/contracts/hunter/IOfferHuntFindRepository';
import type { IOfferHunterSettingsRepository } from '../../../domain/contracts/hunter/IOfferHunterSettingsRepository';
import type { ISheinCatalogClient, SheinCatalogPage, SheinCatalogQuery, SheinCatalogSearchQuery, SheinSession } from '../../../domain/contracts/ISheinCatalogClient';
import type { AffiliateCredentialState } from '../../../domain/contracts/IAffiliateCredentialGateway';
import type { HuntRankingInput, HuntRankingPick, IHuntCandidateRanker } from '../../hunter/contracts/IHuntCandidateRanker';
import type { OfferHunt, OfferHuntFind, OfferHuntFindStatus, OfferHunterSettings, OfferHuntPauseReason, OfferHuntRun } from '../../../domain/hunter/OfferHunt';
import type { HuntCommissionBand } from '../../../domain/hunter/HuntCandidate';
import { huntCandidate } from '../../../domain/services/hunter/huntTestFixtures';
import { ENTITLEMENT_KEYS } from '../../../../tenants/domain/entitlementKeys';

export const TENANT = 'tenant-1';
export const HUNT = 'hunt-1';
export const AT_TOKEN = 'SECRET-AT-TOKEN-123';
export const MEMBER = 'member-9';
export const NOW = new Date('2026-11-12T15:00:00.000Z');

/** Entitlements de um tenant MAX com tudo liberado. */
export const MAX_ENTITLEMENTS = {
  [ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED]: true,
  [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]: true,
  [ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY]: 10,
};

export function makeHunt(patch: Partial<OfferHunt> = {}): OfferHunt {
  return {
    id: HUNT, tenantId: TENANT, name: 'Maior comissão', status: 'ACTIVE', pauseReason: null,
    sort: 'RECOMMENDED', categoryId: null, commissionBand: null, keyword: null, filters: {},
    aiEnabled: false, topN: 3, repeatAfterDays: 7, deliveryMode: 'REVIEW',
    intervalMinutes: 60, windowStartMinute: 0, windowEndMinute: 1440, weekdaysMask: 127,
    nextRunAt: null, lastRunAt: null, consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW, ...patch,
  };
}

export class InMemoryHunts implements Pick<IOfferHuntRepository, 'findById' | 'pause' | 'recordSuccess' | 'recordSourceFailure' | 'update'> {
  constructor(public items: OfferHunt[] = [makeHunt()]) {}
  async findById(tenantId: string, id: string) { return this.items.find((h) => h.id === id && h.tenantId === tenantId) ?? null; }
  async update(tenantId: string, id: string, patch: OfferHuntPatch) {
    const h = await this.findById(tenantId, id);
    if (!h) return null;
    Object.assign(h, patch);
    return h;
  }
  async pause(tenantId: string, id: string, reason: OfferHuntPauseReason) {
    const h = await this.findById(tenantId, id);
    if (!h) return false;
    Object.assign(h, { status: 'PAUSED', pauseReason: reason });
    return true;
  }
  async recordSuccess(tenantId: string, id: string, at: Date) {
    const h = await this.findById(tenantId, id);
    if (h) Object.assign(h, { lastRunAt: at, consecutiveFailures: 0 });
  }
  async recordSourceFailure(tenantId: string, id: string, at: Date, pauseAfter: number) {
    const h = (await this.findById(tenantId, id))!;
    h.consecutiveFailures++;
    h.lastRunAt = at;
    const paused = h.consecutiveFailures >= pauseAfter;
    if (paused) Object.assign(h, { status: 'PAUSED', pauseReason: 'SOURCE_UNAVAILABLE' });
    return { consecutiveFailures: h.consecutiveFailures, paused };
  }
}

export class InMemoryRuns implements Pick<IOfferHuntRunRepository, 'startWithinDailyLimit' | 'createSkipped' | 'finish' | 'incrementSent' | 'countStartedSince'> {
  items: OfferHuntRun[] = [];
  private seq = 0;
  private make(input: StartOfferHuntRunInput, patch: Partial<OfferHuntRun>): OfferHuntRun {
    const run: OfferHuntRun = {
      id: `run-${++this.seq}`, tenantId: input.tenantId, huntId: input.huntId, trigger: input.trigger, status: 'RUNNING',
      seenCount: 0, matchedCount: 0, chosenCount: 0, sentCount: 0, aiUsed: false, aiFallback: false,
      errorCode: null, startedAt: input.startedAt, finishedAt: null, ...patch,
    };
    this.items.push(run);
    return run;
  }
  async countStartedSince(tenantId: string, since: Date) {
    return this.items.filter((r) => r.tenantId === tenantId && r.startedAt >= since && r.status !== 'SKIPPED').length;
  }
  async startWithinDailyLimit(input: StartOfferHuntRunInput, quota: { since: Date; limit: number }) {
    if ((await this.countStartedSince(input.tenantId, quota.since)) >= quota.limit) return null;
    return this.make(input, {});
  }
  async createSkipped(input: StartOfferHuntRunInput & { errorCode: string }) {
    return this.make(input, { status: 'SKIPPED', errorCode: input.errorCode, finishedAt: input.startedAt });
  }
  async finish(tenantId: string, id: string, input: FinishOfferHuntRunInput) {
    const r = this.items.find((x) => x.id === id && x.tenantId === tenantId && x.status === 'RUNNING');
    if (r) Object.assign(r, input);
  }
  async incrementSent(tenantId: string, id: string) {
    const r = this.items.find((x) => x.id === id && x.tenantId === tenantId);
    if (r) r.sentCount++;
  }
}

export class InMemoryFinds implements Pick<
  IOfferHuntFindRepository, 'insertWithinDailyLimit' | 'countCreatedSince' | 'recentGoodsIds' | 'findById' | 'transition' | 'reclaimStaleApproved'
> {
  /** Relógio do `updatedAt` gravado (o Prisma usa o do servidor). */
  clock: () => Date = () => NOW;
  items: OfferHuntFind[] = [];
  private seq = 0;
  async insertWithinDailyLimit(tenantId: string, finds: NewOfferHuntFind[], quota: { since: Date; limit: number; repeatSince?: Date }) {
    const room = Math.max(0, quota.limit - (await this.countCreatedSince(tenantId, quota.since)));
    const taken = new Set<string>();
    if (quota.repeatSince) {
      for (const f of this.items) if (f.tenantId === tenantId && f.huntId && f.createdAt >= quota.repeatSince) taken.add(`${f.huntId}:${f.goodsId}`);
    }
    const fresh = finds.filter((f) => {
      if (!quota.repeatSince || !f.huntId) return true;
      const key = `${f.huntId}:${f.goodsId}`;
      if (taken.has(key)) return false;
      taken.add(key);
      return true;
    });
    return fresh.slice(0, room).map((f) => {
      const row: OfferHuntFind = { ...f, id: `find-${++this.seq}`, tenantId, failureReason: null, offerId: null, createdAt: NOW, updatedAt: NOW };
      this.items.push(row);
      return row;
    });
  }
  async countCreatedSince(tenantId: string, since: Date) {
    return this.items.filter((f) => f.tenantId === tenantId && f.createdAt >= since).length;
  }
  async recentGoodsIds(tenantId: string, huntId: string, since: Date) {
    return new Set(this.items.filter((f) => f.tenantId === tenantId && f.huntId === huntId && f.createdAt >= since).map((f) => f.goodsId));
  }
  async findById(tenantId: string, id: string) { return this.items.find((f) => f.id === id && f.tenantId === tenantId) ?? null; }
  async reclaimStaleApproved(tenantId: string, id: string, before: Date) {
    const f = await this.findById(tenantId, id);
    if (!f || f.status !== 'APPROVED' || f.offerId !== null || f.updatedAt >= before) return false;
    f.updatedAt = this.clock();
    return true;
  }
  async transition(tenantId: string, id: string, from: OfferHuntFindStatus[], to: OfferHuntFindStatus, extra: OfferHuntFindTransition = {}) {
    const f = await this.findById(tenantId, id);
    if (!f || !from.includes(f.status)) return false;
    f.status = to;
    if (extra.offerId !== undefined) f.offerId = extra.offerId;
    if (extra.failureReason !== undefined) f.failureReason = extra.failureReason;
    return true;
  }
  /** Achado já gravado (ex.: dias atrás). */
  seed(patch: Partial<OfferHuntFind>): OfferHuntFind {
    const c = huntCandidate();
    const row: OfferHuntFind = {
      id: `find-${++this.seq}`, tenantId: TENANT, huntId: HUNT, runId: null, goodsId: c.goodsId, skcCode: null, activityId: null,
      title: c.title!, imageUrl: c.imageUrl, priceCents: c.priceCents, originalPriceCents: c.retailPriceCents, discountPercent: c.discountPct,
      commissionPercent: c.commissionNewPct, commissionCents: c.commissionNewCents, returningCommissionPercent: null,
      returningCommissionCents: null, extraCommissionCents: 0, salesBucket: c.sales, reviewsBucket: c.reviews, rating: c.rating,
      score: 50, factors: [], aiReason: null, status: 'PENDING_REVIEW', failureReason: null, offerId: null,
      createdAt: NOW, updatedAt: NOW, ...patch,
    };
    this.items.push(row);
    return row;
  }
}

export class InMemorySettings implements Pick<IOfferHunterSettingsRepository, 'get' | 'upsert'> {
  items = new Map<string, OfferHunterSettings>();
  async get(tenantId: string) { return this.items.get(tenantId) ?? null; }
  async upsert(tenantId: string, sessionId: string, conversationId: string) {
    const s = { tenantId, sessionId, conversationId, updatedAt: NOW };
    this.items.set(tenantId, s);
    return s;
  }
}

/** Catálogo com páginas pré-montadas; registra toda chamada (o teste afirma zero chamadas). */
export class FakeCatalog implements ISheinCatalogClient {
  calls: { method: string; session: SheinSession; query?: unknown }[] = [];
  pages: SheinCatalogPage[] = [{ items: [huntCandidate()], hasNextPage: false, total: 1 }];
  error: Error | null = null;
  categories = [{ categoryId: null, name: 'All', did: 100 }, { categoryId: '4436', name: 'Women Apparel', did: 101 }];
  private hit(method: string, session: SheinSession, query?: unknown) {
    this.calls.push({ method, session, query });
    if (this.error) throw this.error;
  }
  async listCategories(session: SheinSession) { this.hit('listCategories', session); return this.categories; }
  async resolveCommissionBand(session: SheinSession, band: HuntCommissionBand) { this.hit('resolveCommissionBand', session, band); return 900; }
  async list(session: SheinSession, query: SheinCatalogQuery) { this.hit('list', session, query); return this.pages[query.page - 1] ?? { items: [], hasNextPage: false, total: 0 }; }
  async search(session: SheinSession, query: SheinCatalogSearchQuery) { this.hit('search', session, query); return this.pages[query.page - 1] ?? { items: [], hasNextPage: false, total: 0 }; }
}

export class FakeCredentials {
  state: AffiliateCredentialState = {
    state: 'ok', cred: { provider: 'SHEIN', publicIdentifier: MEMBER, secret: null, session: { cookies: { AT: AT_TOKEN } } },
  };
  resolveCalls = 0;
  rejected: string[] = [];
  async resolveState() { this.resolveCalls++; return this.state; }
  async markRejected(_t: string, _p: string, code: string) { this.rejected.push(code); }
}

export class FakeRiskGate {
  accepted = true;
  calls: unknown[][] = [];
  async isAccepted(...args: unknown[]) { this.calls.push(args); return this.accepted; }
}

export class FakeRanker implements IHuntCandidateRanker {
  inputs: HuntRankingInput[] = [];
  constructor(public result: HuntRankingPick[] | null = null) {}
  async rank(input: HuntRankingInput) { this.inputs.push(input); return this.result; }
}
