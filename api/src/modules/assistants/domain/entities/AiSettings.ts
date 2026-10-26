/** Chaves de `PlatformSetting`. Ausente = true. */
export const AI_SETTING_KEYS = {
  platformEnabled: 'ai.platform.enabled',
  tenantKeysEnabled: 'ai.tenant_keys.enabled',
} as const;

export interface AiSettings {
  platformEnabled: boolean;
  tenantKeysEnabled: boolean;
}
