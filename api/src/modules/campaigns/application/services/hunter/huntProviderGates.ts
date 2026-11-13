// Portões por marca do Caçador de Ofertas (MM-05). Ordem: plano da marca → caçador → credencial → aceite → saldo.
import type { HuntProvider } from '../../../domain/hunter/HuntProvider';
import { ENTITLEMENT_KEYS, type EntitlementKey } from '../../../../tenants/domain/entitlementKeys';

/** Chave de plano da marca: SHEIN `marketplace_shein_enabled`; ML livre (D7: basta `offer_hunter_enabled`). */
export const HUNT_PROVIDER_PLAN_KEY: Readonly<Record<HuntProvider, EntitlementKey | null>> = Object.freeze({
  SHEIN: ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED,
  MERCADO_LIVRE: null,
});
