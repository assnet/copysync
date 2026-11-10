import type { MarketplaceRiskAcceptance } from '../entities/MarketplaceRiskAcceptance';
import type { AffiliateProvider } from '../enums/AffiliateProvider';

export interface CreateMarketplaceRiskAcceptanceRecord {
  tenantId: string;
  provider: AffiliateProvider;
  noticeVersion: string;
  acceptedByUserId: string;
  locale: string;
}

export interface CreateMarketplaceRiskAcceptanceResult {
  acceptance: MarketplaceRiskAcceptance;
  /** false = já existia aceite da mesma versão; a linha devolvida é a existente. */
  created: boolean;
}

/**
 * Aceites do aviso de risco. Toda consulta escopada por `tenantId`.
 * Sem update/delete de propósito: o aceite é registro de prova e nunca muda.
 */
export interface IMarketplaceRiskAcceptanceRepository {
  findCurrent(
    tenantId: string,
    provider: AffiliateProvider,
    noticeVersion: string,
  ): Promise<MarketplaceRiskAcceptance | null>;
  /** Conflito de unique (tenant, provider, versão) devolve a linha existente com `created: false`. */
  create(input: CreateMarketplaceRiskAcceptanceRecord): Promise<CreateMarketplaceRiskAcceptanceResult>;
  /** Mais recentes primeiro. */
  listByTenant(tenantId: string): Promise<MarketplaceRiskAcceptance[]>;
}
