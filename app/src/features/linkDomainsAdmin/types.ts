/** Contrato de `/api/admin/link-domains` (ver `.specs/features/link-rotation/api-contract.md`). */
export type LinkDomainStatus = 'ACTIVE' | 'PAUSED';

export type LinkDomainProbeReason =
  | 'REDIRECT'
  | 'UNEXPECTED_STATUS'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'BLOCKED_ADDRESS'
  | 'UNRESOLVABLE';

export interface LinkDomain {
  id: string;
  hostname: string;
  status: LinkDomainStatus;
  landingUrl: string | null;
  reservedNames: string[];
  /** Nomes especiais: só o cliente com liberação (`PremiumSlugGrant`) usa. */
  premiumNames: string[];
  lastProbeAt: string | null;
  lastProbeOk: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLinkDomainRequest {
  hostname: string;
  landingUrl?: string;
  reservedNames?: string[];
  premiumNames?: string[];
}

/** `landingUrl: null` remove a landing (domínio puro cai na página 404 da marca). */
export interface UpdateLinkDomainRequest {
  status?: LinkDomainStatus;
  landingUrl?: string | null;
  reservedNames?: string[];
  premiumNames?: string[];
}

export interface LinkDomainProbeResult {
  ok: boolean;
  reason: LinkDomainProbeReason | null;
  /** Código HTTP recebido (REDIRECT/UNEXPECTED_STATUS); `null` quando nem houve resposta. */
  status: number | null;
  probedAt: string;
}

/** Liberação de um nome especial do domínio para um cliente (tenant). */
export interface PremiumSlugGrant {
  id: string;
  domainId: string;
  slug: string;
  tenantId: string;
  source: 'MANUAL' | 'BILLING';
  /** `null` = sem validade. */
  expiresAt: string | null;
  createdAt: string;
}

export interface CreatePremiumGrantRequest {
  tenantId: string;
  slug: string;
  expiresAt?: string | null;
}
