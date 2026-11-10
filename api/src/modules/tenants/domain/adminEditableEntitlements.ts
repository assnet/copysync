import { ENTITLEMENT_KEYS, type EntitlementKey } from './entitlementKeys';

/**
 * Chaves de entitlement que o super admin altera por plano (rota admin). O seed e a migration de dados
 * só criam o preset dessas chaves, nunca sobrescrevem: senão desfariam a liberação feita pelo admin.
 * Fora desta lista, o preset é só o de `planPresets.ts`.
 */
export const ADMIN_EDITABLE_ENTITLEMENT_KEYS = [ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED] as const;

export type AdminEditableEntitlementKey = (typeof ADMIN_EDITABLE_ENTITLEMENT_KEYS)[number];

export function isAdminEditableEntitlementKey(key: string): key is AdminEditableEntitlementKey & EntitlementKey {
  return (ADMIN_EDITABLE_ENTITLEMENT_KEYS as readonly string[]).includes(key);
}
