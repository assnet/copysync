import type { IEntitlementReader } from '../../domain/contracts/IEntitlementReader';
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import { marketplaceEntitlementKey } from '../../domain/services/marketplaceEntitlement';
import { PlanFeatureUnavailableError } from '../../../../shared/errors/internal/PlanErrors';

/** true quando o marketplace não tem chave de plano ou o plano a libera (só `true` libera). */
export async function isMarketplaceEnabled(
  entitlements: IEntitlementReader,
  tenantId: string,
  provider: AffiliateProvider,
): Promise<boolean> {
  const key = marketplaceEntitlementKey(provider);
  if (key === null) return true;
  return (await entitlements.getBoolean(tenantId, key)) === true;
}

/** Marketplace fora do plano → `PlanFeatureUnavailableError(key)` (403). Sem chave: libera. */
export async function requireMarketplaceEnabled(
  entitlements: IEntitlementReader,
  tenantId: string,
  provider: AffiliateProvider,
): Promise<void> {
  const key = marketplaceEntitlementKey(provider);
  if (key === null) return;
  if ((await entitlements.getBoolean(tenantId, key)) !== true) throw new PlanFeatureUnavailableError(key);
}
