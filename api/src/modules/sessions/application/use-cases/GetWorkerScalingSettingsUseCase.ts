import type { IWorkerScalingSettingsRepository } from '../../domain/contracts/IWorkerScalingSettingsRepository';
import {
  parseSavedWorkerScalingSettings,
  resolveEffectiveSettings,
  type WorkerScalingEnvDefaults,
  type WorkerScalingSettings,
  type WorkerScalingSettingsOrigin,
  type WorkerScalingSettingsPatch,
} from '../../domain/services/workerScalingSettings';
import type { IWorkerHeartbeatRepository } from '../../domain/contracts/IWorkerHeartbeatRepository';
import { WORKER_ALIVE_MS } from '../../domain/services/sessionAdoptionPolicy';
import { logger } from '../../../../shared/logger/logger';

/** Recorte do logger usado pelo check (pino). */
export interface WorkerScalingEnforcedCheckLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

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
 * Falha na consulta não vira 500 (no PUT já gravou): vale só a flag deste processo, com `warn`.
 */
export function workerScalingEnforcedCheck(
  adoptionEnabled: () => boolean,
  heartbeats: Pick<IWorkerHeartbeatRepository, 'hasAlive'>,
  log: WorkerScalingEnforcedCheckLogger = logger,
): () => Promise<boolean> {
  return async () => {
    if (adoptionEnabled()) return true;
    try {
      return await heartbeats.hasAlive(WORKER_ALIVE_MS);
    } catch (err) {
      log.warn({ err: (err as Error | null)?.name }, 'worker scaling settings: alive check failed; using local adoption flag');
      return false;
    }
  };
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
