// Fakes em memória dos repositórios de oferta — só para testes dos use cases.
import type { CreateOfferInput, DailyQuota, IOfferRepository, OfferPatch, UpdateOfferResult } from '../../domain/contracts/IOfferRepository';
import { EDITABLE_OFFER_STATUSES } from '../../domain/contracts/IOfferRepository';
import type {
  IOfferDispatchRepository,
  NewOfferDispatchItem,
  OfferDispatchResult,
} from '../../domain/contracts/IOfferDispatchRepository';
import type { IOfferDestinationRepository } from '../../domain/contracts/IOfferDestinationRepository';
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
    text: '🛒 https://www.amazon.com.br/dp/B0ABCDEFGH?tag=t-20', textEdited: false, status: 'DRAFT',
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
  async update(id: string, tenantId: string, patch: OfferPatch): Promise<UpdateOfferResult> {
    const o = await this.findById(id, tenantId);
    if (!o) return { outcome: 'not_found' };
    if (!EDITABLE_OFFER_STATUSES.includes(o.status)) return { outcome: 'not_editable' };
    Object.assign(o, patch);
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

  async startSending(offerId: string, tenantId: string, items: NewOfferDispatchItem[]) {
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
  async claimDue(now: Date, limit: number) {
    const due = this.items.filter((d) => d.status === 'QUEUED' && d.notBefore <= now).slice(0, limit);
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
    const sending = this.offers.items.filter((o) => o.status === 'SENDING');
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

export class InMemoryOfferDestinationRepository implements IOfferDestinationRepository {
  selected: string[] = [];

  /** Conversas existentes por tenant. */
  constructor(private readonly conversations: Record<string, string[]> = { [TENANT]: [] }) {}

  async list(tenantId: string): Promise<OfferDestinationView[]> {
    const owned = this.conversations[tenantId] ?? [];
    return this.selected
      .filter((id) => owned.includes(id))
      .map((conversationId) => ({ conversationId, title: conversationId, isGroup: true, sessionId: 's1' }));
  }
  async replace(_tenantId: string, ids: string[]) {
    this.selected = [...ids];
  }
  async filterOwnedConversations(tenantId: string, ids: string[]) {
    const owned = this.conversations[tenantId] ?? [];
    return ids.filter((id) => owned.includes(id));
  }
}
