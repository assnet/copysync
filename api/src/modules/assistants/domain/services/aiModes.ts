import type { AiSettings } from '../entities/AiSettings';
import type { AiMode } from '../enums/AiProviderKind';

/** Invariante: pelo menos um modo de IA fica ligado. */
export function isValidAiSettings(s: AiSettings): boolean {
  return s.platformEnabled || s.tenantKeysEnabled;
}

export interface AiAvailabilityFacts {
  settings: AiSettings;
  entitlementEnabled: boolean;
  hasEnabledPlatformProvider: boolean;
  tenantCredentialEnabled: boolean;
}

/** Plataforma serve o tenant: ligada, permitida pelo plano e com provedor ativo. */
export function isPlatformAvailable(f: AiAvailabilityFacts): boolean {
  return f.settings.platformEnabled && f.entitlementEnabled && f.hasEnabledPlatformProvider;
}

/** Modo efetivo, na ordem da resolução (plataforma → chave do tenant → nenhum). */
export function resolveAiMode(f: AiAvailabilityFacts): AiMode {
  if (isPlatformAvailable(f)) return 'PLATFORM';
  if (f.settings.tenantKeysEnabled && f.tenantCredentialEnabled) return 'TENANT';
  return 'NONE';
}
