import type { CreateLinkDomainInput, ILinkDomainRepository, UpdateLinkDomainInput } from '../../../domain/contracts/ILinkDomainRepository';
import type { LinkDomain } from '../../../domain/entities/LinkDomain';
import { LinkDomainStatus } from '../../../domain/enums/LinkRotationEnums';
import type { CreatePremiumSlugGrantInput, IPremiumSlugGrantRepository } from '../../../domain/contracts/IPremiumSlugGrantRepository';
import type { PremiumSlugGrant } from '../../../domain/entities/PremiumSlugGrant';
import type { CreateAuditLogInput, IAuditLogRepository } from '../../../../../shared/audit/IAuditLogRepository';
import { LinkSlugTakenError } from '../../../../../shared/errors/internal/LinkRotationErrors';
import { NotFoundError } from '../../../../../shared/errors/internal/ResourceErrors';

/** Dublê em memória para os testes dos use cases admin. */
export class FakeLinkDomainRepository implements ILinkDomainRepository {
  rows = new Map<string, LinkDomain>();
  rotations = new Map<string, number>();
  /** Claims + grants por domínio. */
  slugUsage = new Map<string, number>();
  probes: Array<{ id: string; ok: boolean; at: Date }> = [];
  private seq = 0;

  seed(partial: Partial<LinkDomain> & { hostname: string }): LinkDomain {
    const now = new Date(0);
    const row: LinkDomain = {
      id: partial.id ?? `d${++this.seq}`, status: LinkDomainStatus.ACTIVE, landingUrl: null, reservedNames: [], premiumNames: [],
      lastProbeAt: null, lastProbeOk: null, createdAt: now, updatedAt: now, ...partial,
    };
    this.rows.set(row.id, row);
    return row;
  }
  async list() { return [...this.rows.values()]; }
  async listActive() { return [...this.rows.values()].filter((d) => d.status === LinkDomainStatus.ACTIVE); }
  async findById(id: string) { return this.rows.get(id) ?? null; }
  async findByHostname(h: string) { return [...this.rows.values()].find((d) => d.hostname === h) ?? null; }
  async create(input: CreateLinkDomainInput) {
    return this.seed({
      hostname: input.hostname, landingUrl: input.landingUrl ?? null,
      reservedNames: input.reservedNames ?? [], premiumNames: input.premiumNames ?? [],
    });
  }
  async update(id: string, input: UpdateLinkDomainInput) {
    const row = { ...this.rows.get(id)!, ...input } as LinkDomain;
    this.rows.set(id, row);
    return row;
  }
  async delete(id: string) { this.rows.delete(id); }
  async countRotations(id: string) { return this.rotations.get(id) ?? 0; }
  async countSlugUsage(id: string) { return this.slugUsage.get(id) ?? 0; }
  async recordProbe(id: string, ok: boolean, at: Date) {
    this.probes.push({ id, ok, at });
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, lastProbeOk: ok, lastProbeAt: at });
  }
}

/** Grants em memória: unique (domínio, slug) e tenants conhecidos, como no banco. */
export class FakePremiumSlugGrantRepository implements IPremiumSlugGrantRepository {
  rows: PremiumSlugGrant[] = [];
  tenants = new Set(['tenant-1', 'tenant-2']);
  private seq = 0;
  async listByDomain(domainId: string) { return this.rows.filter((g) => g.domainId === domainId); }
  async findById(domainId: string, id: string) { return this.rows.find((g) => g.id === id && g.domainId === domainId) ?? null; }
  async create(input: CreatePremiumSlugGrantInput) {
    if (this.rows.some((g) => g.domainId === input.domainId && g.slug === input.slug)) throw new LinkSlugTakenError([]);
    if (!this.tenants.has(input.tenantId)) throw new NotFoundError('Tenant', input.tenantId);
    const row: PremiumSlugGrant = { ...input, id: `g${++this.seq}`, createdAt: new Date(0) };
    this.rows.push(row);
    return row;
  }
  async delete(domainId: string, id: string) { this.rows = this.rows.filter((g) => !(g.id === id && g.domainId === domainId)); }
}

export class FakeAuditLog implements IAuditLogRepository {
  entries: CreateAuditLogInput[] = [];
  async create(input: CreateAuditLogInput) { this.entries.push(input); }
}
