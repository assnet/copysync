import type { LinkDomain as PrismaLinkDomain } from '@prisma/client';
import type { LinkDomain } from '../../domain/entities/LinkDomain';
import { LinkDomainStatus } from '../../domain/enums/LinkRotationEnums';

/** Prisma → domínio (domínio de links da plataforma). */
export class PrismaLinkDomainMapper {
  static toDomain(raw: PrismaLinkDomain): LinkDomain {
    return {
      id: raw.id,
      hostname: raw.hostname,
      status: raw.status as LinkDomainStatus,
      landingUrl: raw.landingUrl,
      reservedNames: [...raw.reservedNames],
      premiumNames: [...raw.premiumNames],
      lastProbeAt: raw.lastProbeAt,
      lastProbeOk: raw.lastProbeOk,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }
}
