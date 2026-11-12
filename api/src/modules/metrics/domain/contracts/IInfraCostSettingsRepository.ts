import type { InfraCostSettings } from '../services/infraCostSettings';

/**
 * Linha `platform_settings["infra_costs"]` (COST-01/03). Dado de plataforma, sem `tenantId`.
 * `value` sai cru do banco (pode nem ser objeto): quem lê valida com `resolveInfraCostSettings`.
 */
export interface InfraCostSettingsRecord {
  value: unknown;
  updatedAt: Date;
  /** Admin que salvou por último; `null` se desconhecido. */
  updatedById: string | null;
}

export interface IInfraCostSettingsRepository {
  /** Linha salva com `updatedAt` real mesmo se `value` for inválido; `null` só sem linha. */
  get(): Promise<InfraCostSettingsRecord | null>;
  /**
   * Grava `value` já validado (`parseInfraCostSettings`). `expectedUpdatedAt` é o `updatedAt`
   * lido antes (`null` = não havia linha). Se a linha mudou (ou passou a existir) desde então,
   * lança `InfraCostSettingsConflictError` (`shared/errors/internal/InfraCostErrors`) sem gravar.
   */
  save(value: InfraCostSettings, actorId: string, expectedUpdatedAt: Date | null): Promise<InfraCostSettingsRecord>;
}
