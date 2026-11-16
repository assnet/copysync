// Portões por marca do Caçador de Ofertas (MM-05). Ordem: plano da marca → caçador → credencial → aceite → saldo.
import type { HuntProvider, HuntSourceSession } from '../../../domain/hunter/HuntProvider';
import type { IHuntProviderAdapter } from '../../../domain/contracts/hunter/IHuntProviderAdapter';
import type { IAffiliateCredentialGateway } from '../../../domain/contracts/IAffiliateCredentialGateway';
import type { IEntitlementReader } from '../../../domain/contracts/IEntitlementReader';
import type { IMarketplaceRiskGate } from '../../../domain/contracts/IMarketplaceRiskGate';
import { ENTITLEMENT_KEYS, type EntitlementKey } from '../../../../tenants/domain/entitlementKeys';
import { currentRiskNoticeVersion } from '../../../../integrations/domain/services/marketplaceRiskNotice';
import { PlanFeatureUnavailableError } from '../../../../../shared/errors/internal/PlanErrors';
import { MarketplaceRiskNotAcceptedError } from '../../../../../shared/errors/internal/MarketplaceRiskErrors';
import { AffiliateCredentialRejectedError, AffiliateCredentialRequiredError } from '../../../../../shared/errors/internal/OfferErrors';

/** Chave de plano da marca: SHEIN `marketplace_shein_enabled`; ML livre (D7: basta `offer_hunter_enabled`). */
export const HUNT_PROVIDER_PLAN_KEY: Readonly<Record<HuntProvider, EntitlementKey | null>> = Object.freeze({
  SHEIN: ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED,
  MERCADO_LIVRE: null,
});

export interface HuntBrandGateDeps {
  entitlements: Pick<IEntitlementReader, 'getBoolean'>;
  credentials: Pick<IAffiliateCredentialGateway, 'resolveState'>;
  riskGate: IMarketplaceRiskGate;
}

/**
 * Portões da marca sem o saldo do dia (execução e reaproveitamento do ranking): plano da marca → caçador →
 * credencial com sessão da marca → aceite `OFFER_HUNTER`. Só banco, nenhuma chamada à fonte. Lança o erro do
 * portão (`PLAN_FEATURE_UNAVAILABLE`, `AFFILIATE_CREDENTIAL_REJECTED`/`_REQUIRED`, `MARKETPLACE_RISK_NOT_ACCEPTED`).
 */
export async function assertHuntBrandGates(deps: HuntBrandGateDeps, tenantId: string, adapter: IHuntProviderAdapter): Promise<HuntSourceSession> {
  const provider = adapter.provider;
  const planKey = HUNT_PROVIDER_PLAN_KEY[provider];
  if (planKey && (await deps.entitlements.getBoolean(tenantId, planKey)) !== true) throw new PlanFeatureUnavailableError(planKey);
  if ((await deps.entitlements.getBoolean(tenantId, ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED)) !== true) {
    throw new PlanFeatureUnavailableError(ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED);
  }
  const state = await deps.credentials.resolveState(tenantId, provider);
  if (state.state === 'rejected') throw new AffiliateCredentialRejectedError(provider);
  const session = state.state === 'ok' ? adapter.sessionFrom(state.cred) : null;
  if (!session) throw new AffiliateCredentialRequiredError(provider);
  if (!(await deps.riskGate.isAccepted(tenantId, provider, 'OFFER_HUNTER'))) {
    throw new MarketplaceRiskNotAcceptedError(provider, currentRiskNoticeVersion(provider, 'OFFER_HUNTER') ?? '', 'OFFER_HUNTER');
  }
  return session;
}
