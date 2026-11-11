import type {
  IWorkerScalingSettingsRepository,
  WorkerScalingSettingsRecord,
} from '../../domain/contracts/IWorkerScalingSettingsRepository';
import {
  parseWorkerScalingSettings,
  resolveEffectiveSettings,
  type WorkerScalingEnvDefaults,
  type WorkerScalingSettings,
  type WorkerScalingSettingsOrigin,
  type WorkerScalingSettingsPatch,
} from '../../domain/services/workerScalingSettings';

/** Resposta de leitura/gravação da configuração de escala (WSCALE-06). */
export interface WorkerScalingSettingsView {
  settings: WorkerScalingSettings;
  origin: WorkerScalingSettingsOrigin;
  /** ISO do último salvamento; `null` sem linha salva. Vai como `expectedUpdatedAt` no PUT. */
  updatedAt: string | null;
  /** Adoção ligada: com `false` a configuração é gravada mas sem efeito. */
  enforced: boolean;
}

export interface WorkerScalingSettingsViewDeps {
  envDefaults: WorkerScalingEnvDefaults;
  /** Adoção ligada no processo (`WORKER_ADOPTION_ENABLED`); lido pelo composition root. */
  isEnforced: () => boolean;
}

/**
 * Valor salvo validado. Linha inválida no banco (gravada fora da API) cai no default,
 * como o provider faz, para a tela abrir e o admin poder regravar.
 */
export function parseSavedWorkerScalingSettings(record: WorkerScalingSettingsRecord | null): WorkerScalingSettingsPatch | null {
  if (!record) return null;
  try {
    return parseWorkerScalingSettings(record.value);
  } catch {
    return null;
  }
}

export function presentWorkerScalingSettings(
  saved: WorkerScalingSettingsPatch | null,
  updatedAt: Date | null,
  deps: WorkerScalingSettingsViewDeps,
): WorkerScalingSettingsView {
  const effective = resolveEffectiveSettings(saved, deps.envDefaults);
  return {
    settings: effective.value,
    origin: effective.origin,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
    enforced: deps.isEnforced(),
  };
}

/** Super admin lê a configuração efetiva, a origem por campo e o `updatedAt` (direto do banco). */
export class GetWorkerScalingSettingsUseCase {
  constructor(
    private readonly repository: IWorkerScalingSettingsRepository,
    private readonly deps: WorkerScalingSettingsViewDeps,
  ) {}

  async execute(): Promise<WorkerScalingSettingsView> {
    const record = await this.repository.get();
    return presentWorkerScalingSettings(parseSavedWorkerScalingSettings(record), record?.updatedAt ?? null, this.deps);
  }
}
