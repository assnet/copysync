import type { IEntitlementReader } from '../../../tenants/domain/contracts/IEntitlementReader';
import type { IStorefrontRepository } from '../../domain/contracts/IStorefrontRepository';
import { StorefrontStatus } from '../../domain/enums/StorefrontEnums';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';

/**
 * Plano → status da página (STORE-02). Só `storefront_enabled === true` mantém no ar; ausente/false/
 * inválido pausa (`PAUSED_BY_PLAN`, nome mantido). Chamado pelo billing no mesmo client/tx dos entitlements.
 * Devolve o status gravado, ou null quando o tenant não tem página.
 */
export class ApplyPlanToStorefrontUseCase {
  constructor(
    private readonly storefronts: IStorefrontRepository,
    private readonly entitlements: IEntitlementReader,
  ) {}

  async execute(tenantId: string): Promise<StorefrontStatus | null> {
    const enabled = await this.entitlements.getBoolean(tenantId, ENTITLEMENT_KEYS.STOREFRONT_ENABLED);
    return this.storefronts.setStatus(tenantId, enabled === true ? StorefrontStatus.ACTIVE : StorefrontStatus.PAUSED_BY_PLAN);
  }
}
