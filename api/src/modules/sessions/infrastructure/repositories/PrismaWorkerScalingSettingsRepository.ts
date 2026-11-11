import { Prisma, type PrismaClient } from '@prisma/client';
import { logger } from '../../../../shared/logger/logger';
import { WorkerScalingSettingsConflictError } from '../../../../shared/errors/internal/WorkerScalingErrors';
import type {
  IWorkerScalingSettingsRepository,
  WorkerScalingSettingsRecord,
} from '../../domain/contracts/IWorkerScalingSettingsRepository';
import type { WorkerScalingSettingsPatch } from '../../domain/services/workerScalingSettings';

/** Chave em `platform_settings` (WSCALE-01). */
export const WORKER_SCALING_SETTINGS_KEY = 'worker_scaling';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Concorrência otimista por `updatedAt` (WSCALE-06): `null` = cria (linha existente ou corrida
 * no create = conflito); data = `updateMany` condicionado; 0 linhas = conflito.
 */
export class PrismaWorkerScalingSettingsRepository implements IWorkerScalingSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(): Promise<WorkerScalingSettingsRecord | null> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: WORKER_SCALING_SETTINGS_KEY } });
    if (!row) return null;
    if (!isObject(row.value)) {
      // Sem o conteúdo no log: só o tipo.
      logger.warn({ key: WORKER_SCALING_SETTINGS_KEY, valueType: Array.isArray(row.value) ? 'array' : typeof row.value },
        'worker scaling settings: stored value is not an object, ignoring');
      return null;
    }
    return { value: row.value, updatedAt: row.updatedAt, updatedById: row.updatedById };
  }

  async save(
    value: WorkerScalingSettingsPatch,
    actorId: string,
    expectedUpdatedAt: Date | null,
  ): Promise<WorkerScalingSettingsRecord> {
    const json = value as Prisma.InputJsonValue;
    if (expectedUpdatedAt === null) {
      try {
        const row = await this.prisma.platformSetting.create({
          data: { key: WORKER_SCALING_SETTINGS_KEY, value: json, updatedById: actorId },
        });
        return { value: row.value, updatedAt: row.updatedAt, updatedById: row.updatedById };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new WorkerScalingSettingsConflictError();
        }
        throw err;
      }
    }
    // Sempre depois do esperado: duas gravações no mesmo ms não podem repetir o `updatedAt`.
    const updatedAt = new Date(Math.max(Date.now(), expectedUpdatedAt.getTime() + 1));
    const { count } = await this.prisma.platformSetting.updateMany({
      where: { key: WORKER_SCALING_SETTINGS_KEY, updatedAt: expectedUpdatedAt },
      data: { value: json, updatedById: actorId, updatedAt },
    });
    if (count === 0) throw new WorkerScalingSettingsConflictError();
    return { value, updatedAt, updatedById: actorId };
  }
}
