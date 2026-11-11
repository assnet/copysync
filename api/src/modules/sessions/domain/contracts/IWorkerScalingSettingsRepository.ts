import type { WorkerScalingSettingsPatch } from '../services/workerScalingSettings';

/**
 * Linha `platform_settings["worker_scaling"]` (WSCALE-01/06). Dado de plataforma, sem `tenantId`.
 * `value` sai cru do banco (pode nem ser objeto): quem lê valida com `parseSavedWorkerScalingSettings`.
 */
export interface WorkerScalingSettingsRecord {
  value: unknown;
  updatedAt: Date;
  /** Admin que salvou por último; `null` se desconhecido. */
  updatedById: string | null;
}

export interface IWorkerScalingSettingsRepository {
  /** Linha salva com `updatedAt` real mesmo se `value` for inválido; `null` só sem linha. */
  get(): Promise<WorkerScalingSettingsRecord | null>;
  /**
   * Grava `value` já validado. `expectedUpdatedAt` é o `updatedAt` lido antes (`null` = não
   * havia linha). Se a linha mudou (ou passou a existir) desde então, lança
   * `WorkerScalingSettingsConflictError` (`shared/errors/internal/WorkerScalingErrors`) sem gravar.
   */
  save(
    value: WorkerScalingSettingsPatch,
    actorId: string,
    expectedUpdatedAt: Date | null,
  ): Promise<WorkerScalingSettingsRecord>;
}
