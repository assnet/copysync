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
import type { IWorkerHeartbeatRepository } from '../../domain/contracts/IWorkerHeartbeatRepository';
import { WORKER_ALIVE_MS } from '../../domain/services/sessionAdoptionPolicy';

/** Resposta de leitura/gravação da configuração de escala (WSCALE-06). */
export interface WorkerScalingSettingsView {
  settings: WorkerScalingSettings;
  origin: WorkerScalingSettingsOrigin;
  /** ISO do último salvamento; `null` sem linha salva. Vai como `expectedUpdatedAt` no PUT. */
  updatedAt: string | null;
  /** Adoção ligada em algum processo: com `false` a configuração é gravada mas sem efeito. */
  enforced: boolean;
}

export interface WorkerScalingSettingsViewDeps {
  envDefaults: WorkerScalingEnvDefaults;
  /** Adoção em vigor no cluster (`workerScalingEnforcedCheck`); montado pelo composition root. */
  isEnforced: () => Promise<boolean>;
}

/**
 * Em vigor = adoção ligada neste processo OU algum batimento vivo em `worker_heartbeats` (só
 * existe com a adoção). Com `PROCESS_ROLE=http` separado a flag mora só no worker: o batimento
 * dele é o que diz à rota que a configuração vale. "Vivo" = o mesmo de `ListWorkersUseCase`.
 */
export function workerScalingEnforcedCheck(
  adoptionEnabled: () => boolean,
  heartbeats: Pick<IWorkerHeartbeatRepository, 'listAlive'>,
): () => Promise<boolean> {
  return async () => adoptionEnabled() || (await heartbeats.listAlive(WORKER_ALIVE_MS)).length > 0;
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

export async function presentWorkerScalingSettings(
  saved: WorkerScalingSettingsPatch | null,
  updatedAt: Date | null,
  deps: WorkerScalingSettingsViewDeps,
): Promise<WorkerScalingSettingsView> {
  const effective = resolveEffectiveSettings(saved, deps.envDefaults);
  return {
    settings: effective.value,
    origin: effective.origin,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
    enforced: await deps.isEnforced(),
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
