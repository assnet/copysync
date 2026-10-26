import type { AiProviderKind } from '../enums/AiProviderKind';

/** Chave de IA do próprio tenant (uma por tenant). Nunca carrega a chave. */
export interface TenantAiCredential {
  tenantId: string;
  kind: AiProviderKind;
  model: string;
  enabled: boolean;
  updatedAt: Date;
}
