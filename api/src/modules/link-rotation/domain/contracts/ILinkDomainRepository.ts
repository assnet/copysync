import type { LinkDomain } from '../entities/LinkDomain';
import type { LinkDomainStatus } from '../enums/LinkRotationEnums';

export interface CreateLinkDomainInput {
  hostname: string;
  landingUrl?: string | null;
  reservedNames?: string[];
  premiumNames?: string[];
}

export interface UpdateLinkDomainInput {
  status?: LinkDomainStatus;
  landingUrl?: string | null;
  reservedNames?: string[];
  premiumNames?: string[];
}

/** Domínios de links da plataforma (admin). Sem tenant: o recurso é global. */
export interface ILinkDomainRepository {
  list(): Promise<LinkDomain[]>;
  listActive(): Promise<LinkDomain[]>;
  findById(id: string): Promise<LinkDomain | null>;
  findByHostname(hostname: string): Promise<LinkDomain | null>;
  create(input: CreateLinkDomainInput): Promise<LinkDomain>;
  update(id: string, input: UpdateLinkDomainInput): Promise<LinkDomain>;
  delete(id: string): Promise<void>;
  /** Rotações que apontam para o domínio (bloqueia exclusão: LINK_DOMAIN_IN_USE). */
  countRotations(id: string): Promise<number>;
  /** Claims de nome (rodízio/página) + grants premium no domínio (FK Restrict: também bloqueiam). */
  countSlugUsage(id: string): Promise<number>;
  recordProbe(id: string, ok: boolean, at: Date): Promise<void>;
}
