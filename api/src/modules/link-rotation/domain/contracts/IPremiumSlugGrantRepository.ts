import type { PremiumSlugGrant, PremiumSlugGrantSource } from '../entities/PremiumSlugGrant';

export interface CreatePremiumSlugGrantInput {
  domainId: string;
  slug: string;
  tenantId: string;
  source: PremiumSlugGrantSource;
  expiresAt: Date | null;
}

/**
 * Liberações de nome premium (super-admin). Recurso do domínio: lista por domínio, sem filtro de
 * tenant (o super-admin vê todos); cada grant carrega o `tenantId` beneficiado.
 * Erros: nome já concedido → `LinkSlugTakenError([])`; tenant inexistente → `NotFoundError('Tenant')`.
 */
export interface IPremiumSlugGrantRepository {
  listByDomain(domainId: string): Promise<PremiumSlugGrant[]>;
  findById(domainId: string, id: string): Promise<PremiumSlugGrant | null>;
  create(input: CreatePremiumSlugGrantInput): Promise<PremiumSlugGrant>;
  delete(domainId: string, id: string): Promise<void>;
}
