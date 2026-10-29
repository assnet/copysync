import type { CreateLinkDomainInput, ILinkDomainRepository, UpdateLinkDomainInput } from '../../../domain/contracts/ILinkDomainRepository';
import type { LinkDomain } from '../../../domain/entities/LinkDomain';
import { LinkDomainStatus } from '../../../domain/enums/LinkRotationEnums';

/** Dublê em memória para os testes dos use cases admin. */
export class FakeLinkDomainRepository implements ILinkDomainRepository {
  rows = new Map<string, LinkDomain>();
  rotations = new Map<string, number>();
  probes: Array<{ id: string; ok: boolean; at: Date }> = [];
  private seq = 0;

  seed(partial: Partial<LinkDomain> & { hostname: string }): LinkDomain {
    const now = new Date(0);
    const row: LinkDomain = {
      id: partial.id ?? `d${++this.seq}`, status: LinkDomainStatus.ACTIVE, landingUrl: null, reservedNames: [],
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
    return this.seed({ hostname: input.hostname, landingUrl: input.landingUrl ?? null, reservedNames: input.reservedNames ?? [] });
  }
  async update(id: string, input: UpdateLinkDomainInput) {
    const row = { ...this.rows.get(id)!, ...input } as LinkDomain;
    this.rows.set(id, row);
    return row;
  }
  async delete(id: string) { this.rows.delete(id); }
  async countRotations(id: string) { return this.rotations.get(id) ?? 0; }
  async recordProbe(id: string, ok: boolean, at: Date) {
    this.probes.push({ id, ok, at });
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, lastProbeOk: ok, lastProbeAt: at });
  }
}
