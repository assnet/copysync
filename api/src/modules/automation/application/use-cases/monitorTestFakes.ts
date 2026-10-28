import type { ActiveMonitoredGroup, BroadcastGroupInput, IGroupMonitorRepository, MonitoredGroupInput, TenantGroupJids } from '../../domain/contracts/IGroupMonitorRepository';
import type { CapturedOfferListItem, CapturedOfferResolution, ICapturedOfferRepository, NewCapturedOffer } from '../../domain/contracts/ICapturedOfferRepository';
import type { IMonitorGroupDirectory, IOfferQueue, ITenantLinkBuilder, QueueOfferInput, QueueOfferResult, TenantLinkResult } from '../../domain/contracts/IMonitorPorts';
import type { BroadcastGroup, GroupMonitorConfig, GroupMonitorSettings, MonitoredGroup } from '../../domain/entities/GroupMonitor';
import type { CapturedOffer, CapturedOfferReason } from '../../domain/entities/CapturedOffer';
import { DEFAULT_MONITOR_SETTINGS } from '../../domain/services/monitorSettings';

export const TENANT = 'tenant-1';
export const SESSION = 'session-1';
export const NOW = new Date('2026-10-28T15:00:00.000Z'); // 12:00 em São Paulo

export class InMemoryGroupMonitorRepository implements IGroupMonitorRepository {
  sessions = new Set([`${TENANT}:${SESSION}`, `${TENANT}:session-2`]);
  configs: GroupMonitorConfig[] = [];
  monitored: (MonitoredGroup & { tenantId: string; sessionId: string })[] = [];
  broadcast: (BroadcastGroup & { tenantId: string; sessionId: string })[] = [];
  private seq = 0;

  async sessionExists(tenantId: string, sessionId: string) { return this.sessions.has(`${tenantId}:${sessionId}`); }
  async findConfig(tenantId: string, sessionId: string) {
    return this.configs.find((c) => c.tenantId === tenantId && c.sessionId === sessionId) ?? null;
  }
  async saveSettings(tenantId: string, sessionId: string, settings: GroupMonitorSettings) {
    const found = await this.findConfig(tenantId, sessionId);
    if (found) { Object.assign(found, settings); return found; }
    const c = { id: `cfg-${++this.seq}`, tenantId, sessionId, ...settings };
    this.configs.push(c);
    return c;
  }
  async ensureConfig(tenantId: string, sessionId: string) {
    return (await this.findConfig(tenantId, sessionId))?.id ?? (await this.saveSettings(tenantId, sessionId, DEFAULT_MONITOR_SETTINGS)).id;
  }
  async listMonitored(tenantId: string, sessionId: string) { return this.monitored.filter((g) => g.tenantId === tenantId && g.sessionId === sessionId); }
  async listBroadcast(tenantId: string, sessionId: string) {
    return this.broadcast.filter((g) => g.tenantId === tenantId && g.sessionId === sessionId).sort((a, b) => a.position - b.position);
  }
  async replaceMonitored(tenantId: string, sessionId: string, _configId: string, groups: MonitoredGroupInput[]) {
    this.monitored = this.monitored.filter((g) => !(g.tenantId === tenantId && g.sessionId === sessionId));
    for (const g of groups) this.monitored.push({ id: `mg-${++this.seq}`, tenantId, sessionId, title: null, avatarUrl: null, ...g });
  }
  async replaceBroadcast(tenantId: string, sessionId: string, _configId: string, groups: BroadcastGroupInput[]) {
    this.broadcast = this.broadcast.filter((g) => !(g.tenantId === tenantId && g.sessionId === sessionId));
    groups.forEach((g, position) => this.broadcast.push({ id: `bg-${++this.seq}`, tenantId, sessionId, title: null, avatarUrl: null, position, ...g }));
  }
  async tenantGroupJids(tenantId: string): Promise<TenantGroupJids> {
    return {
      monitored: this.monitored.filter((g) => g.tenantId === tenantId).map(({ sessionId, groupJid }) => ({ sessionId, groupJid })),
      broadcast: this.broadcast.filter((g) => g.tenantId === tenantId).map(({ sessionId, groupJid }) => ({ sessionId, groupJid })),
    };
  }
  async findActiveMonitoredGroup(tenantId: string, sessionId: string, groupJid: string): Promise<ActiveMonitoredGroup | null> {
    const cfg = await this.findConfig(tenantId, sessionId);
    const g = this.monitored.find((x) => x.tenantId === tenantId && x.sessionId === sessionId && x.groupJid === groupJid);
    return cfg?.enabled && g ? { id: g.id, tenantId, configId: cfg.id, keywords: g.keywords } : null;
  }
}

export class InMemoryCapturedOfferRepository implements ICapturedOfferRepository {
  items: CapturedOffer[] = [];
  private seq = 0;

  async createPending(input: NewCapturedOffer) {
    if (this.items.some((c) => c.sessionId === input.sessionId && c.sourceExternalMessageId === input.sourceExternalMessageId)) return false;
    this.items.push({
      id: `cap-${++this.seq}`, marketplace: null, sourceUrl: null, affiliateUrl: null, coupon: null, finalText: null,
      status: 'PENDING', reason: null, offerId: null, startsAt: null, expiresAt: null, processedAt: null, claimToken: null, ...input,
    });
    return true;
  }
  async claimPending(limit: number) {
    const due = this.items.filter((c) => c.status === 'PENDING').slice(0, limit);
    for (const c of due) Object.assign(c, { status: 'PROCESSING', claimToken: `tok-${++this.seq}` });
    return due.map((c) => ({ ...c }));
  }
  private own(id: string, token: string) { return this.items.find((c) => c.id === id && c.claimToken === token && c.status === 'PROCESSING'); }
  async markQueued(id: string, token: string, data: CapturedOfferResolution & { offerId: string }) {
    const c = this.own(id, token); if (!c) return false; Object.assign(c, data, { status: 'QUEUED', reason: null }); return true;
  }
  async markSkipped(id: string, token: string, reason: CapturedOfferReason, data: Partial<CapturedOfferResolution> = {}) {
    const c = this.own(id, token); if (!c) return false; Object.assign(c, data, { status: 'SKIPPED', reason }); return true;
  }
  async markFailed(id: string, token: string, reason: CapturedOfferReason, data: Partial<CapturedOfferResolution> = {}) {
    const c = this.own(id, token); if (!c) return false; Object.assign(c, data, { status: 'FAILED', reason }); return true;
  }
  async list(tenantId: string, sessionId: string, offset: number, limit: number): Promise<CapturedOfferListItem[]> {
    return this.items.filter((c) => c.tenantId === tenantId && c.sessionId === sessionId).slice(offset, offset + limit)
      .map((c) => ({ ...c, sourceGroupTitle: 'Concorrente', sourceGroupAvatarUrl: null, offerStatus: null, sentCount: 0, totalCount: 0 }));
  }
  async findById(tenantId: string, id: string) {
    const c = this.items.find((x) => x.tenantId === tenantId && x.id === id);
    return c ? { ...c, sourceGroupTitle: 'Concorrente', sourceGroupAvatarUrl: null, offerStatus: null, sentCount: 0, totalCount: 0 } : null;
  }
  async resetForRetry(tenantId: string, id: string) {
    const c = this.items.find((x) => x.tenantId === tenantId && x.id === id && (x.status === 'SKIPPED' || x.status === 'FAILED'));
    if (!c) return false; Object.assign(c, { status: 'PENDING', reason: null, claimToken: null }); return true;
  }
}

export class FakeLinkBuilder implements ITenantLinkBuilder {
  calls: string[] = [];
  constructor(public resolve: (href: string) => TenantLinkResult = (href) => (href.includes('amzn.to')
    ? { kind: 'ok', provider: 'AMAZON', sourceUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH', affiliateUrl: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=meu-20' }
    : { kind: 'unsupported' })) {}
  async build(_tenantId: string, href: string) { this.calls.push(href); return this.resolve(href); }
}

export class FakeOfferQueue implements IOfferQueue {
  inputs: QueueOfferInput[] = [];
  result: (i: QueueOfferInput) => QueueOfferResult = (i) => ({ kind: 'queued', offerId: 'offer-9', firstSendAt: i.startAt });
  async enqueue(input: QueueOfferInput) { this.inputs.push(input); return this.result(input); }
}

export class FakeDirectory implements IMonitorGroupDirectory {
  mediaEnabled: string[] = [];
  async ensureGroup(_t: string, _s: string, groupJid: string) { return { conversationId: `conv-${groupJid}` }; }
  async enableMediaDownload(_t: string, conversationId: string) { this.mediaEnabled.push(conversationId); }
}

export class FakeEntitlements {
  constructor(public values: Record<string, unknown> = {}) {}
  async getNumber(_t: string, key: string) { const v = this.values[key]; return typeof v === 'number' ? v : null; }
  async getBoolean(_t: string, key: string) { const v = this.values[key]; return typeof v === 'boolean' ? v : null; }
}
