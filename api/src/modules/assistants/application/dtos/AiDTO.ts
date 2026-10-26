import type { AiMode, AiProviderKind } from '../../domain/enums/AiProviderKind';

export interface CreateAiPlatformProviderInput {
  userId: string;
  kind: AiProviderKind;
  label: string;
  model?: string;
  apiKey: string;
  enabled?: boolean;
  priority?: number;
  dailyLimitPerTenant?: number | null;
  /** Só `OPENAI_COMPATIBLE` (obrigatória nele); ignorada nos demais. */
  baseUrl?: string | null;
}

export interface UpdateAiPlatformProviderInput {
  userId: string;
  id: string;
  label?: string;
  model?: string;
  /** Vazio = mantém a atual. */
  apiKey?: string;
  enabled?: boolean;
  priority?: number;
  dailyLimitPerTenant?: number | null;
  baseUrl?: string | null;
}

export interface UpsertTenantAiCredentialInput {
  tenantId: string;
  userId: string;
  kind: AiProviderKind;
  model?: string;
  /** Vazio mantém a atual; obrigatória na criação e na troca de `kind`. */
  apiKey?: string;
  enabled?: boolean;
}

export interface AiCredentialView {
  kind: AiProviderKind;
  model: string;
  masked: string;
  enabled: boolean;
}

export interface AiStatusDTO {
  mode: AiMode;
  tenantKeysAllowed: boolean;
  platformAvailable: boolean;
  credential: AiCredentialView | null;
}

/** Item de `GET /ai/catalog`: o painel monta o seletor por aqui. */
export interface AiCatalogItemDTO {
  kind: AiProviderKind;
  label: string;
  defaultModel: string | null;
  requiresBaseUrl: boolean;
  tenantAllowed: boolean;
}

/** Resultado do `POST .../test`: falha do provedor vira `ok: false`, não erro HTTP. */
export interface AiTestResultDTO {
  ok: boolean;
  errorCode?: string;
}
