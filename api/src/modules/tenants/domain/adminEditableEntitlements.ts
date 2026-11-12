import { ENTITLEMENT_KEYS, type EntitlementKey } from './entitlementKeys';

/**
 * Tipo do valor de uma chave editável. `integer` = inteiro em [min, max] (inclusive); `null` nunca
 * é aceito pela rota admin (ilimitado não é decisão do super admin).
 */
export type AdminEntitlementValueType =
  | { kind: 'boolean' }
  | { kind: 'integer'; min: number; max: number };

/**
 * Chaves de entitlement que o super admin altera por plano (rota admin), com o tipo de cada uma.
 * O seed e a migration de dados só criam o preset dessas chaves, nunca sobrescrevem: senão desfariam
 * a liberação feita pelo admin. Fora desta lista, o preset é só o de `planPresets.ts`.
 */
export const ADMIN_EDITABLE_ENTITLEMENTS = {
  [ENTITLEMENT_KEYS.MARKETPLACE_SHEIN_ENABLED]: { kind: 'boolean' },
  [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED]: { kind: 'boolean' },
  [ENTITLEMENT_KEYS.OFFER_HUNTER_FINDS_PER_DAY]: { kind: 'integer', min: 0, max: 100 },
} as const satisfies Partial<Record<EntitlementKey, AdminEntitlementValueType>>;

export type AdminEditableEntitlementKey = keyof typeof ADMIN_EDITABLE_ENTITLEMENTS;

/** Ordem de exibição na tela admin. */
export const ADMIN_EDITABLE_ENTITLEMENT_KEYS = Object.keys(ADMIN_EDITABLE_ENTITLEMENTS) as readonly AdminEditableEntitlementKey[];

export function isAdminEditableEntitlementKey(key: string): key is AdminEditableEntitlementKey & EntitlementKey {
  return Object.prototype.hasOwnProperty.call(ADMIN_EDITABLE_ENTITLEMENTS, key);
}

export function adminEntitlementTypeOf(key: AdminEditableEntitlementKey): AdminEntitlementValueType {
  return ADMIN_EDITABLE_ENTITLEMENTS[key];
}

/** Valor aceito para o tipo: boolean de verdade, ou inteiro dentro da faixa (sem coerção de string). */
export function isValidAdminEntitlementValue(type: AdminEntitlementValueType, value: unknown): value is boolean | number {
  if (type.kind === 'boolean') return typeof value === 'boolean';
  return typeof value === 'number' && Number.isInteger(value) && value >= type.min && value <= type.max;
}
