import type { AffiliateProvider } from '../enums/AffiliateProvider';
import { ENTITLEMENT_KEYS, type EntitlementKey } from '../../../tenants/domain/entitlementKeys';

/**
 * Chave do limite de identificadores vinculados por provider. Só provider com sessão em que a conta tem
 * várias etiquetas (hoje o Mercado Livre); ausente = sem lista da conta nem vinculadas.
 */
const IDENTIFIER_LIMIT_KEY: Partial<Record<AffiliateProvider, EntitlementKey>> = {
  MERCADO_LIVRE: ENTITLEMENT_KEYS.MERCADO_LIVRE_AFFILIATE_TAGS,
};

export function affiliateIdentifierLimitKey(provider: AffiliateProvider): EntitlementKey | null {
  return IDENTIFIER_LIMIT_KEY[provider] ?? null;
}
