import type { WorkerScalingSettingsPatch } from '../services/workerScalingSettings';

/**
 * Linha `platform_settings["worker_scaling"]` (WSCALE-01/06). Dado de plataforma, sem `tenantId`.
 * `value` sai cru do banco: quem lê valida com `parseWorkerScalingSettings`.
 */
export interface WorkerScalingSettingsRecord {
  value: unknown;
  updatedAt: Date;
  /** Admin que salvou por último; `null` se desconhecido. */
  updatedById: string | null;
}

export interface IWorkerScalingSettingsRepository {
  /** Linha salva, ou `null` sem linha. */
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
