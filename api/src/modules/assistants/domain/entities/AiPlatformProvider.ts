import type { AiProviderKind } from '../enums/AiProviderKind';

/** Provedor de IA da plataforma. Nunca carrega a chave, só `hasKey`. */
export interface AiPlatformProvider {
  id: string;
  kind: AiProviderKind;
  label: string;
  model: string;
  enabled: boolean;
  /** Menor valor = usado primeiro. */
  priority: number;
  /** null = sem teto além dos limites do plano. */
  dailyLimitPerTenant: number | null;
  hasKey: boolean;
  createdAt: Date;
  updatedAt: Date;
}
