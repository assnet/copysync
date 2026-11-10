import type { IMarketplaceRiskAcceptanceRepository } from '../../domain/contracts/IMarketplaceRiskAcceptanceRepository';
import type { MarketplaceRiskAcceptance } from '../../domain/entities/MarketplaceRiskAcceptance';

/** Consulta de suporte (super admin): aceites de um tenant, mais recentes primeiro. */
export class ListMarketplaceRiskAcceptancesUseCase {
  constructor(private readonly repo: IMarketplaceRiskAcceptanceRepository) {}

  execute(tenantId: string): Promise<MarketplaceRiskAcceptance[]> {
    return this.repo.listByTenant(tenantId);
  }
}
