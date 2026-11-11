import type { IAuditLogRepository } from '../../../../shared/audit/IAuditLogRepository';
import { InvalidWorkerScalingSettingsError } from '../../../../shared/errors/internal/WorkerScalingErrors';
import type { IWorkerScalingSettingsProvider } from '../../domain/contracts/IWorkerScalingSettingsProvider';
import type { IWorkerScalingSettingsRepository } from '../../domain/contracts/IWorkerScalingSettingsRepository';
import {
  assertReplicaRange,
  parseWorkerScalingSettings,
  resolveEffectiveSettings,
  WORKER_SCALING_FIELDS,
  type WorkerScalingSettings,
} from '../../domain/services/workerScalingSettings';
import {
  parseSavedWorkerScalingSettings,
  presentWorkerScalingSettings,
  type WorkerScalingSettingsView,
  type WorkerScalingSettingsViewDeps,
} from './GetWorkerScalingSettingsUseCase';

export interface UpdateWorkerScalingSettingsCommand {
  /** Objeto completo (todos os campos); validado aqui. */
  settings: unknown;
  /** `updatedAt` lido no GET; `null` = não havia linha salva. */
  expectedUpdatedAt: string | null;
  /** Super admin que salvou (auditoria e `updatedById`). */
  actorUserId: string;
}

/**
 * Super admin grava a configuração de escala (WSCALE-06): valida o objeto completo, grava com
 * controle de concorrência (`WorkerScalingSettingsConflictError` 409 propaga), audita antes/depois
 * (`WORKER_SCALING_SETTINGS_CHANGED`) e aplica no processo com `provider.refresh()`.
 */
export class UpdateWorkerScalingSettingsUseCase {
  constructor(
    private readonly repository: IWorkerScalingSettingsRepository,
    private readonly audit: IAuditLogRepository,
    private readonly provider: IWorkerScalingSettingsProvider,
    private readonly deps: WorkerScalingSettingsViewDeps,
  ) {}

  async execute(cmd: UpdateWorkerScalingSettingsCommand): Promise<WorkerScalingSettingsView> {
    const patch = parseWorkerScalingSettings(cmd.settings);
    for (const field of WORKER_SCALING_FIELDS) {
      if (patch[field] === undefined) throw new InvalidWorkerScalingSettingsError(field, 'is required');
    }
    const settings = patch as WorkerScalingSettings;
    assertReplicaRange(settings);
    const expectedUpdatedAt = parseExpectedUpdatedAt(cmd.expectedUpdatedAt);

    const previous = await this.repository.get();
    const before = resolveEffectiveSettings(parseSavedWorkerScalingSettings(previous), this.deps.envDefaults).value;

    const saved = await this.repository.save(settings, cmd.actorUserId, expectedUpdatedAt);
    await this.audit.create({
      userId: cmd.actorUserId,
      action: 'WORKER_SCALING_SETTINGS_CHANGED',
      meta: { before, after: settings },
    });
    await this.provider.refresh();
    return presentWorkerScalingSettings(settings, saved.updatedAt, this.deps);
  }
}

function parseExpectedUpdatedAt(raw: string | null): Date | null {
  if (raw === null) return null;
  const date = typeof raw === 'string' ? new Date(raw) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidWorkerScalingSettingsError('expectedUpdatedAt', 'must be an ISO date or null');
  }
  return date;
}
