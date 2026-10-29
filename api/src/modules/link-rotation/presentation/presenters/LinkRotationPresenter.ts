import type {
  LinkRotationGroupOutputDTO,
  LinkRotationOutputDTO,
  LinkRotationOverviewDTO,
} from '../../application/dtos/LinkRotationDTO';
import type { LinkRotationStatsDTO } from '../../application/use-cases/GetLinkRotationStatsUseCase';
import type { LinkDomain } from '../../domain/entities/LinkDomain';
import type { PremiumSlugGrant } from '../../domain/entities/PremiumSlugGrant';
import type { ProbeLinkDomainResult } from '../../application/use-cases/admin/ProbeLinkDomainUseCase';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Saída HTTP do rodízio: datas em ISO, nunca entidade/model cru. */
export const LinkRotationPresenter = {
  group(g: LinkRotationGroupOutputDTO) {
    return { ...g, memberCountAt: iso(g.memberCountAt), lastClickAt: iso(g.lastClickAt) };
  },

  rotation(r: LinkRotationOutputDTO) {
    return {
      ...r,
      lastClickAt: iso(r.lastClickAt),
      allFullNotifiedAt: iso(r.allFullNotifiedAt),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      groups: r.groups.map(LinkRotationPresenter.group),
    };
  },

  overview(o: LinkRotationOverviewDTO) {
    return { ...o, rotations: o.rotations.map(LinkRotationPresenter.rotation) };
  },

  stats(s: LinkRotationStatsDTO) {
    return { ...s, lastClickAt: iso(s.lastClickAt) };
  },
};

/** Saída HTTP do admin de domínios. */
export const LinkDomainPresenter = {
  domain(d: LinkDomain) {
    return {
      id: d.id,
      hostname: d.hostname,
      status: d.status,
      landingUrl: d.landingUrl,
      reservedNames: d.reservedNames,
      premiumNames: d.premiumNames,
      lastProbeAt: iso(d.lastProbeAt),
      lastProbeOk: d.lastProbeOk,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  },

  grant(g: PremiumSlugGrant) {
    return {
      id: g.id,
      domainId: g.domainId,
      slug: g.slug,
      tenantId: g.tenantId,
      source: g.source,
      expiresAt: iso(g.expiresAt),
      createdAt: g.createdAt.toISOString(),
    };
  },

  probe(p: ProbeLinkDomainResult) {
    return { ok: p.ok, reason: p.reason, status: p.status, probedAt: p.probedAt.toISOString() };
  },
};
