import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import { ENTITLEMENT_KEYS, type EntitlementKey } from '../../../tenants/domain/entitlementKeys';

/** Chave do plano que libera o marketplace. Só quem está aqui é travado por plano; ausente = liberado. */
const MARKETPLACE_ENTITLEMENT: Partial<Record<AffiliateProvider, EntitlementKey>> = {
  SHEIN: ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED,
};

export function marketplaceEntitlementKey(provider: AffiliateProvider): EntitlementKey | null {
  return MARKETPLACE_ENTITLEMENT[provider] ?? null;
}
