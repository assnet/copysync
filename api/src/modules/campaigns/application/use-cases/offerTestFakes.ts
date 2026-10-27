// Fakes em memória dos repositórios de oferta — só para testes dos use cases.
import type { CreateOfferInput, DailyQuota, IOfferRepository, OfferPatch, UpdateOfferResult } from '../../domain/contracts/IOfferRepository';
import { EDITABLE_OFFER_STATUSES } from '../../domain/contracts/IOfferRepository';
import type {
  IOfferDispatchRepository,
  NewOfferDispatchItem,
  StartSendingExpectation,
  OfferDispatchResult,
} from '../../domain/contracts/IOfferDispatchRepository';
import type {
  IOfferGeneratorConfigRepository,
  SaveOfferGeneratorConfigInput,
} from '../../domain/contracts/IOfferGeneratorConfigRepository';
import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import type { OfferGeneratorConfig, OfferSessionRef } from '../../domain/entities/OfferGeneratorConfig';
import type { Offer } from '../../domain/entities/Offer';
import type { OfferDispatch } from '../../domain/entities/OfferDispatch';
import type { OfferDestinationView } from '../../domain/entities/OfferDestination';
import { OFFER_DISPATCH_STATUSES, type OfferDispatchStatus } from '../../domain/enums/OfferDispatchStatus';
import type { OfferStatus } from '../../domain/enums/OfferStatus';
import { PlanLimitReachedError } from '../../../../shared/errors/internal/PlanErrors';

export const TENANT = 'tenant-1';
export const USER = 'user-1';
export const NOW = new Date('2026-10-26T15:00:00.000Z');

export function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'offer-1', tenantId: TENANT, provider: 'AMAZON', sourceUrl: 'https://amazon.com.br/dp/B0ABCDEFGH',
    productRef: 'B0ABCDEFGH', title: null, priceCents: null, originalPriceCents: null, imageUrl: null,
    affiliateUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=t-20', attributionVerified: true,
    text: '🛒 https://www.amazon.com.br/dp/B0ABCDEFGH?tag=t-20', textEdited: false, coupon: null, audience: 'STANDARD', mentionAll: false, simulateTyping: false, typingSeconds: 15, scheduledAt: null, status: 'DRAFT',
    createdById: USER, createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

export class InMemoryOfferRepository implements IOfferRepository {
  items: Offer[] = [];
  private seq = 0;

  async create(input: CreateOfferInput): Promise<Offer> {
    const offer = makeOffer({ ...input, id: `offer-new-${++this.seq}`, textEdited: false, status: 'DRAFT' });
    this.items.push(offer);
    return offer;
  }
  async createWithinDailyLimit(input: CreateOfferInput, quota: DailyQuota): Promise<Offer> {
    if ((await this.countCreatedSince(input.tenantId, quota.since)) >= quota.limit) {
      throw new PlanLimitReachedError(quota.key, quota.limit);
    }
    return this.create(input);
  }
  async findById(id: string, tenantId: string) {
    return this.items.find((o) => o.id === id && o.tenantId === tenantId) ?? null;
  }
  async update(id: string, tenantId: string, patch: OfferPatch, expectedUpdatedAt?: Date): Promise<UpdateOfferResult> {
    const o = await this.findById(id, tenantId);
    if (!o) return { outcome: 'not_found' };
    if (!EDITABLE_OFFER_STATUSES.includes(o.status)) return { outcome: 'not_editable' };
    if (expectedUpdatedAt && o.updatedAt.getTime() !== expectedUpdatedAt.getTime()) return { outcome: 'changed' };
    Object.assign(o, patch, { updatedAt: new Date(o.updatedAt.getTime() + 1) });
    return { outcome: 'updated', offer: o };
  }
  async countCreatedSince(tenantId: string, since: Date) {
    return this.items.filter((o) => o.tenantId === tenantId && o.createdAt >= since).length;
  }
  async transitionStatus(id: string, tenantId: string, from: OfferStatus[], to: OfferStatus) {
    const o = await this.findById(id, tenantId);
    if (!o || !from.includes(o.status)) return false;
    o.status = to;
    return true;
  }
}

export class InMemoryOfferDispatchRepository implements IOfferDispatchRepository {
  items: OfferDispatch[] = [];
  private seq = 0;

  constructor(private readonly offers: InMemoryOfferRepository) {}

  async startSending(offerId: string, tenantId: string, expected: StartSendingExpectation, items: NewOfferDispatchItem[]) {
    if ((await this.offers.findById(offerId, tenantId))?.mentionAll !== expected.mentionAll) return null;
    const moved = await this.offers.transitionStatus(offerId, tenantId, ['DRAFT'], 'SENDING');
    if (!moved) return null;
    const created = items.map((i) => this.add({ tenantId, offerId, ...i }));
    return created;
  }
  add(d: Partial<OfferDispatch> & { offerId: string; conversationId: string }): OfferDispatch {
    const row: OfferDispatch = {
      id: `d-${++this.seq}`, tenantId: TENANT, status: 'QUEUED', notBefore: NOW, claimedAt: null, claimToken: null,
      chatMessageId: null, failureReason: null, updatedAt: NOW, ...d,
    };
    this.items.push(row);
    return row;
  }
  async listByOffer(offerId: string, tenantId: string) {
    return this.items.filter((d) => d.offerId === offerId && d.tenantId === tenantId);
  }
  private tokenSeq = 0;
  async rescheduleQueued(offerId: string, tenantId: string, slots: Date[]) {
    const queued = (await this.listByOffer(offerId, tenantId))
      .filter((d) => d.status === 'QUEUED')
      .sort((a, b) => a.notBefore.getTime() - b.notBefore.getTime())
      .slice(0, slots.length);
    queued.forEach((d, i) => { d.notBefore = slots[i]!; });
    return queued.length;
  }
  async cancelQueued(offerId: string, tenantId: string) {
    const queued = (await this.listByOffer(offerId, tenantId)).filter((d) => d.status === 'QUEUED');
    for (const d of queued) d.status = 'CANCELLED';
    return queued.length;
  }
  async claimDue(now: Date, limit: number) {
    const due = this.items
      .filter((d) => d.status === 'QUEUED' && d.notBefore <= now)
      .filter((d) => this.offers.items.find((o) => o.id === d.offerId)?.status === 'SENDING')
      .slice(0, limit);
    for (const d of due) Object.assign(d, { status: 'SENDING', claimedAt: now, claimToken: `tok-${++this.tokenSeq}` });
    return due.map((d) => ({ ...d }));
  }
  async touchClaim(id: string, claimToken: string) {
    const d = this.items.find((x) => x.id === id && x.claimToken === claimToken && x.status === 'SENDING');
    if (!d) return false;
    d.claimedAt = NOW;
    return true;
  }
  async releaseStale(olderThan: Date) {
    const stale = this.items.filter(
      (d) => d.status === 'SENDING' && d.claimedAt && d.claimedAt < olderThan && !d.chatMessageId,
    );
    for (const d of stale) Object.assign(d, { status: 'QUEUED', claimedAt: null, claimToken: null });
    return stale.length;
  }
  async markResult(id: string, tenantId: string, claimToken: string, result: OfferDispatchResult) {
    const d = this.items.find(
      (x) => x.id === id && x.tenantId === tenantId && x.claimToken === claimToken && x.status === 'SENDING',
    );
    if (!d) return false;
    Object.assign(d, result);
    return true;
  }
  async findSendingWithoutOpenDispatches(limit: number) {
    const sending = this.offers.items.filter((o) => o.status === 'SENDING' || o.status === 'PAUSED');
    const out: { id: string; tenantId: string }[] = [];
    for (const o of sending) {
      if ((await this.countOpen(o.id, o.tenantId)) === 0) out.push({ id: o.id, tenantId: o.tenantId });
    }
    return out.slice(0, limit);
  }
  async countOpen(offerId: string, tenantId: string) {
    return (await this.listByOffer(offerId, tenantId)).filter((d) => d.status === 'QUEUED' || d.status === 'SENDING')
      .length;
  }
  async countByStatus(offerId: string, tenantId: string) {
    const out = Object.fromEntries(OFFER_DISPATCH_STATUSES.map((s) => [s, 0])) as Record<OfferDispatchStatus, number>;
    for (const d of await this.listByOffer(offerId, tenantId)) out[d.status]++;
    return out;
  }
}

/** Conversa conhecida pelo fake de configuração. */
export interface FakeConversation {
  id: string;
  tenantId: string;
  sessionId: string | null;
  isGroup: boolean;
  title?: string;
  groupJid?: string;
}

export class InMemoryOfferGeneratorConfigRepository implements IOfferGeneratorConfigRepository {
  configs = new Map<string, OfferGeneratorConfig>();
  selected = new Map<string, string[]>();
  saves = 0;

  constructor(
    public sessions: (OfferSessionRef & { tenantId: string })[] = [],
    public conversations: FakeConversation[] = [],
  ) {}

  async find(tenantId: string) {
    return this.configs.get(tenantId) ?? null;
  }
  async listGroups(tenantId: string) {
    return (this.selected.get(tenantId) ?? [])
      .map((id) => this.conversations.find((c) => c.id === id && c.tenantId === tenantId))
      .filter((c): c is FakeConversation => !!c)
      .map((c) => ({ conversationId: c.id, title: c.title ?? c.id, avatarUrl: null, isGroup: c.isGroup, sessionId: c.sessionId }));
  }
  async save(input: SaveOfferGeneratorConfigInput) {
    this.saves++;
    const { tenantId, conversationIds, ...rest } = input;
    this.configs.set(tenantId, { tenantId, ...rest, updatedAt: NOW });
    this.selected.set(tenantId, [...conversationIds]);
  }
  async findSession(tenantId: string, sessionId: string) {
    const s = this.sessions.find((x) => x.id === sessionId && x.tenantId === tenantId);
    return s ? { id: s.id, status: s.status } : null;
  }
  async findSessions(tenantId: string, sessionIds: string[]) {
    return sessionIds.flatMap((id) => {
      const s = this.sessions.find((x) => x.id === id && x.tenantId === tenantId);
      return s ? [{ id: s.id, status: s.status }] : [];
    });
  }
  async listSessionGroupConversations(tenantId: string, sessionId: string) {
    return this.conversations
      .filter((c) => c.tenantId === tenantId && c.sessionId === sessionId && c.isGroup && c.groupJid)
      .map((c) => ({ conversationId: c.id, groupJid: c.groupJid!, title: c.title ?? null, avatarUrl: null }));
  }

  async filterSessionGroups(tenantId: string, sessionIds: string[], ids: string[]) {
    return ids.filter((id) =>
      this.conversations.some((c) => c.id === id && c.tenantId === tenantId && c.sessionId != null && sessionIds.includes(c.sessionId) && c.isGroup),
    );
  }
}

/** Entitlements em memória: chave → valor cru (como no JSON do hub). */
export class FakeEntitlementReader implements IEntitlementReader {
  constructor(public values: Record<string, unknown> = {}) {}
  async getNumber(_tenantId: string, key: string) {
    const v = this.values[key];
    return typeof v === 'number' ? v : null;
  }
  async getBoolean(_tenantId: string, key: string) {
    const v = this.values[key];
    return typeof v === 'boolean' ? v : null;
  }
}
