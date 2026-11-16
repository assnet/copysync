import { ENTITLEMENT_KEYS } from './entitlementKeys';

/**
 * Audiência por recurso (flag do admin em `/admin/plan-entitlements`, coluna "Só super admin"): `true` = só super
 * admin vê/usa; `false` = todo tenant com o entitlement. Só as chaves daqui têm audiência (hoje, o caçador).
 * Persistida em `platform_settings["feature_audience"]` como `{ <chave>: boolean }`; chave nunca gravada = valor
 * inicial da env (`OFFER_HUNTER_AUDIENCE`).
 */
export const FEATURE_AUDIENCE_KEYS = [ENTITLEMENT_KEYS.OFFER_HUNTER_ENABLED] as const;
export type FeatureAudienceKey = (typeof FEATURE_AUDIENCE_KEYS)[number];
/** Só as chaves gravadas (ausente = valor inicial). */
export type FeatureAudienceSettings = Partial<Record<FeatureAudienceKey, boolean>>;

export function isFeatureAudienceKey(key: string): key is FeatureAudienceKey {
  return (FEATURE_AUDIENCE_KEYS as readonly string[]).includes(key);
}

/** JSON salvo → só chaves conhecidas com boolean de verdade (lixo/linha antiga = ausente). */
export function parseFeatureAudience(value: unknown): FeatureAudienceSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: FeatureAudienceSettings = {};
  for (const key of FEATURE_AUDIENCE_KEYS) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}
