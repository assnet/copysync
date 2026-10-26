import type { EncryptedBlob } from '../../../../shared/security/ISecretCipher';
import type { AiProviderKind, AiUsageSource } from '../enums/AiProviderKind';

export type { EncryptedBlob };

export interface CreateAiPlatformProviderRecord {
  id: string;
  kind: AiProviderKind;
  label: string;
  model: string;
  apiKey: EncryptedBlob;
  enabled: boolean;
  priority: number;
  dailyLimitPerTenant: number | null;
  baseUrl: string | null;
}

/** Campos ausentes ficam como estão. */
export interface UpdateAiPlatformProviderRecord {
  label?: string;
  model?: string;
  apiKey?: EncryptedBlob;
  enabled?: boolean;
  priority?: number;
  dailyLimitPerTenant?: number | null;
  baseUrl?: string | null;
}

export interface UpsertTenantAiCredentialRecord {
  tenantId: string;
  kind: AiProviderKind;
  model: string;
  enabled: boolean;
  /** Ausente = mantém a chave atual (só vale em registro existente). */
  apiKey?: EncryptedBlob;
}

export interface AiUsageEntry {
  tenantId: string;
  source: AiUsageSource;
  kind: AiProviderKind;
  model: string;
  providerId: string | null;
  purpose: string;
  inputTokens: number | null;
  outputTokens: number | null;
  success: boolean;
}
