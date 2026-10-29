// Fakes em memória do rodízio de links — só para testes dos use cases.
import type {
  CreateLinkRotationInput,
  ILinkRotationRepository,
  PublicLinkRotation,
  SaveLinkRotationGroupInput,
  UpdateLinkRotationGroupInput,
  UpdateLinkRotationInput,
} from '../../domain/contracts/ILinkRotationRepository';
import type { ILinkRotationGroupCatalog, LinkRotationGroupCandidate } from '../../domain/contracts/ILinkRotationGroupCatalog';
import type { ILinkRotationSessionReader, LinkRotationSessionRef } from '../../domain/contracts/ILinkRotationSessionReader';
import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { LinkDomain } from '../../domain/entities/LinkDomain';
import type { LinkRotation, LinkRotationWithGroups } from '../../domain/entities/LinkRotation';
import type { LinkRotationGroup } from '../../domain/entities/LinkRotationGroup';
import { LinkDomainStatus, LinkRotationStatus, LinkRotationStrategy } from '../../domain/enums/LinkRotationEnums';
import { LinkRotationNotFoundError, LinkSlugTakenError } from '../../../../shared/errors/internal/LinkRotationErrors';
import type { LinkDomainReader, LinkRotationGroupEngine, LinkRotationUseCaseDeps } from './linkRotationUseCaseDeps';

export const TENANT = 'tenant-1';
export const OTHER_TENANT = 'tenant-2';
export const SESSION = 'session-1';
export const OTHER_SESSION = 'session-2';
export const NOW = new Date('2026-10-29T12:00:00.000Z');
export const CODE = 'AbCdEfGhIjKlMnOpQrStUv';

export function makeDomain(over: Partial<LinkDomain> = {}): LinkDomain {
  return {
    id: 'dom-1', hostname: 'copysync.com.br', status: LinkDomainStatus.ACTIVE, landingUrl: null,
    reservedNames: [], lastProbeAt: null, lastProbeOk: null, createdAt: NOW, updatedAt: NOW, ...over,
  };
}

interface Reservation { domainId: string; slug: string; tenantId: string; expiresAt: Date }

export class InMemoryLinkRotationRepository implements ILinkRotationRepository {
  rotations: LinkRotation[] = [];
  groups: LinkRotationGroup[] = [];
  reservations: Reservation[] = [];
  /** Simula corrida no unique: próximo create/update lança LinkSlugTakenError([]). */
  raceOnce = false;
  private seq = 0;

  private withGroups(r: LinkRotation): LinkRotationWithGroups {
    return { ...r, groups: this.groups.filter((g) => g.rotationId === r.id).sort((a, b) => a.position - b.position) };
  }

  seed(over: Partial<LinkRotation> = {}): LinkRotation {
    const r: LinkRotation = {
      id: `rot-${++this.seq}`, tenantId: TENANT, sessionId: SESSION, domainId: 'dom-1', slug: `slug-${this.seq}`,
      status: LinkRotationStatus.ACTIVE, strategy: LinkRotationStrategy.BALANCED, title: null, clickCount: 0,
      lastClickAt: null, allFullNotifiedAt: null, createdAt: NOW, updatedAt: NOW, ...over,
    };
    this.rotations.push(r);
    return r;
  }

  seedGroup(rotationId: string, over: Partial<LinkRotationGroup> = {}): LinkRotationGroup {
    const g: LinkRotationGroup = {
      id: `grp-${++this.seq}`, tenantId: TENANT, rotationId, conversationId: `conv-${this.seq}`, groupJid: `jid-${this.seq}`,
      position: 0, weight: 1, capacity: 1000, inviteCode: CODE, linkSource: null, status: 'ACTIVE' as LinkRotationGroup['status'],
      memberCount: null, memberCountAt: null, clicksSinceSync: 0, clickCount: 0, lastClickAt: null, ...over,
    };
    this.groups.push(g);
    return g;
  }

  async listByTenant(tenantId: string) { return this.rotations.filter((r) => r.tenantId === tenantId).map((r) => this.withGroups(r)); }
  async findById(tenantId: string, id: string) {
    const r = this.rotations.find((x) => x.id === id && x.tenantId === tenantId);
    return r ? this.withGroups(r) : null;
  }
  async countByTenant(tenantId: string) { return this.rotations.filter((r) => r.tenantId === tenantId).length; }

  private slugUsed(domainId: string, slug: string, exceptId?: string) {
    return this.rotations.some((r) => r.domainId === domainId && r.slug === slug && r.id !== exceptId);
  }

  async create(input: CreateLinkRotationInput) {
    if (this.raceOnce || this.slugUsed(input.domainId, input.slug)) { this.raceOnce = false; throw new LinkSlugTakenError([]); }
    return this.seed({ ...input, strategy: input.strategy ?? LinkRotationStrategy.BALANCED, title: input.title ?? null });
  }

  async update(tenantId: string, id: string, input: UpdateLinkRotationInput) {
    const r = this.rotations.find((x) => x.id === id && x.tenantId === tenantId);
    if (!r) throw new LinkRotationNotFoundError(id);
    if (input.slug !== undefined && (this.raceOnce || this.slugUsed(input.domainId ?? r.domainId, input.slug, id))) {
      this.raceOnce = false;
      throw new LinkSlugTakenError([]);
    }
    if (input.sessionId !== undefined && input.sessionId !== r.sessionId) {
      this.groups = this.groups.filter((g) => g.rotationId !== id);
    }
    const { sessionId, slug, domainId, status, strategy, title } = input;
    Object.assign(r, Object.fromEntries(Object.entries({ sessionId, slug, domainId, status, strategy, title }).filter(([, v]) => v !== undefined)));
    return { ...r };
  }

  async delete(tenantId: string, id: string) {
    if (!this.rotations.some((r) => r.id === id && r.tenantId === tenantId)) throw new LinkRotationNotFoundError(id);
    this.rotations = this.rotations.filter((r) => r.id !== id);
    this.groups = this.groups.filter((g) => g.rotationId !== id);
  }

  async replaceGroups(tenantId: string, rotationId: string, groups: SaveLinkRotationGroupInput[]) {
    if (!this.rotations.some((r) => r.id === rotationId && r.tenantId === tenantId)) throw new LinkRotationNotFoundError(rotationId);
    const old = new Map(this.groups.filter((g) => g.rotationId === rotationId).map((g) => [g.conversationId, g]));
    this.groups = this.groups.filter((g) => g.rotationId !== rotationId);
    for (const g of groups) {
      const prev = old.get(g.conversationId);
      if (prev) this.groups.push({ ...prev, ...g });
      else this.seedGroup(rotationId, { ...g, tenantId });
    }
    return this.withGroups(this.rotations.find((r) => r.id === rotationId)!).groups;
  }

  async findPublicByHost(): Promise<PublicLinkRotation | null> { return null; }
  async incrementClick(): Promise<void> {}

  private unavailable(domainId: string, slug: string, tenantId: string) {
    return this.slugUsed(domainId, slug) || this.reservations.some(
      (x) => x.domainId === domainId && x.slug === slug && x.tenantId !== tenantId && x.expiresAt > NOW,
    );
  }
  async isSlugAvailable(domainId: string, slug: string, tenantId: string) { return !this.unavailable(domainId, slug, tenantId); }
  async findUnavailableSlugs(domainId: string, slugs: readonly string[], tenantId: string) {
    return slugs.filter((s) => this.unavailable(domainId, s, tenantId));
  }

  async updateGroup(tenantId: string, rotationId: string, groupId: string, input: UpdateLinkRotationGroupInput) {
    const g = this.groups.find((x) => x.id === groupId && x.rotationId === rotationId && x.tenantId === tenantId);
    if (!g) throw new LinkRotationNotFoundError(rotationId);
    Object.assign(g, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)));
    return { ...g };
  }

  async reserveSlug(domainId: string, slug: string, tenantId: string, expiresAt: Date) {
    this.reservations = this.reservations.filter((x) => !(x.domainId === domainId && x.slug === slug));
    this.reservations.push({ domainId, slug, tenantId, expiresAt });
  }
}

export class FakeDomains implements LinkDomainReader {
  constructor(public items: LinkDomain[] = [makeDomain()]) {}
  async findById(id: string) { return this.items.find((d) => d.id === id) ?? null; }
  async list() { return [...this.items]; }
  async listActive() { return this.items.filter((d) => d.status === LinkDomainStatus.ACTIVE); }
}

export class FakeSessions implements ILinkRotationSessionReader {
  constructor(public items: (LinkRotationSessionRef & { tenantId: string })[] = [
    { id: SESSION, tenantId: TENANT, name: 'Principal', status: 'CONNECTED' },
    { id: OTHER_SESSION, tenantId: TENANT, name: 'Reserva', status: 'DISCONNECTED' },
    { id: 'session-x', tenantId: OTHER_TENANT, name: 'Alheia', status: 'CONNECTED' },
  ]) {}
  async listByTenant(tenantId: string) {
    return this.items.filter((s) => s.tenantId === tenantId).map(({ tenantId: _t, ...s }) => s);
  }
  async findById(tenantId: string, id: string) {
    const s = this.items.find((x) => x.id === id && x.tenantId === tenantId);
    return s ? { id: s.id, name: s.name, status: s.status } : null;
  }
}

export class FakeGroupCatalog implements ILinkRotationGroupCatalog {
  constructor(public items: (LinkRotationGroupCandidate & { tenantId: string })[] = []) {}
  add(conversationId: string, over: Partial<LinkRotationGroupCandidate & { tenantId: string }> = {}) {
    this.items.push({ conversationId, tenantId: TENANT, sessionId: SESSION, groupJid: `jid-${conversationId}`, name: `Grupo ${conversationId}`, ...over });
    return this;
  }
  async findGroups(tenantId: string, ids: readonly string[]) {
    return this.items.filter((c) => c.tenantId === tenantId && ids.includes(c.conversationId)).map(({ tenantId: _t, ...c }) => c);
  }
}

export class FakeEntitlements implements IEntitlementReader {
  constructor(public numbers: Record<string, number | null> = {}) {}
  async getNumber(_tenantId: string, key: string) { return this.numbers[key] ?? null; }
  async getBoolean() { return null; }
}

/** Engine: por JID, devolve code ou lança o erro configurado. */
export class FakeEngine implements LinkRotationGroupEngine {
  invites = new Map<string, string | Error>();
  summaries = new Map<string, { name: string; memberCount: number; isSelfAdmin: boolean } | Error>();
  inviteCalls: string[] = [];
  async getGroupInviteLink(_sessionId: string, groupJid: string) {
    this.inviteCalls.push(groupJid);
    const v = this.invites.get(groupJid) ?? CODE;
    if (v instanceof Error) throw v;
    return { inviteCode: v };
  }
  async getGroupSummary(_sessionId: string, groupJid: string) {
    const v = this.summaries.get(groupJid) ?? { name: 'Grupo', memberCount: 10, isSelfAdmin: true };
    if (v instanceof Error) throw v;
    return v;
  }
}

export function makeDeps() {
  return {
    rotations: new InMemoryLinkRotationRepository(),
    domains: new FakeDomains(),
    sessions: new FakeSessions(),
    groups: new FakeGroupCatalog(),
    entitlements: new FakeEntitlements(),
    engine: new FakeEngine(),
    now: () => NOW,
  } satisfies LinkRotationUseCaseDeps;
}
