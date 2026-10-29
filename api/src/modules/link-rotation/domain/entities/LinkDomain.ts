import type { LinkDomainStatus } from '../enums/LinkRotationEnums';

/** Domínio de links da plataforma (sem tenant). `hostname` minúsculo, sem ponto final. */
export interface LinkDomain {
  id: string;
  hostname: string;
  status: LinkDomainStatus;
  /** Destino 301 do apex. */
  landingUrl: string | null;
  /** Nomes reservados além da lista padrão de `slugRules`. */
  reservedNames: string[];
  /** Nomes especiais: só com `PremiumSlugGrant` do tenant. */
  premiumNames: string[];
  lastProbeAt: Date | null;
  lastProbeOk: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}
