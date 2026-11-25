import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import { ENTITLEMENT_KEYS } from '../../../tenants/domain/entitlementKeys';
import type { FeatureAudienceKey } from '../../../tenants/domain/featureAudience';
import type { FeatureAudienceGate, FeatureAudienceViewer } from '../../../tenants/application/services/FeatureAudienceGate';

/**
 * Loja → chave de audiência. Mapa próprio (não o de `marketplaceEntitlement`): lá a Shein é travada por plano mas não
 * tem audiência; aqui só entra loja com flag "Só super admin". Ausente = sempre visível.
 */
const MARKETPLACE_AUDIENCE: Partial<Record<AffiliateProvider, FeatureAudienceKey>> = {
  KABUM: ENTITLEMENT_KEYS.MARKETPLACE_KABUM_ENABLED,
  MAGALU: ENTITLEMENT_KEYS.MARKETPLACE_MAGALU_ENABLED,
  ALIEXPRESS: ENTITLEMENT_KEYS.MARKETPLACE_ALIEXPRESS_ENABLED,
};

/**
 * Audiência por loja, casca sobre o `FeatureAudienceGate`. Shopee, Mercado Livre, Amazon e Shein: sempre visíveis.
 * Kabum, Magalu e AliExpress: flag da loja, lida a cada chamada (nunca gravada = só super admin). Não olha o plano.
 */
export class MarketplaceAudienceGate {
  constructor(private readonly gate: Pick<FeatureAudienceGate, 'isVisible' | 'superAdminOnly'>) {}

  async superAdminOnly(provider: AffiliateProvider): Promise<boolean> {
    const key = MARKETPLACE_AUDIENCE[provider];
    return key ? this.gate.superAdminOnly(key) : false;
  }

  async isVisible(provider: AffiliateProvider, viewer: FeatureAudienceViewer): Promise<boolean> {
    const key = MARKETPLACE_AUDIENCE[provider];
    return key ? this.gate.isVisible(key, viewer) : true;
  }
}
