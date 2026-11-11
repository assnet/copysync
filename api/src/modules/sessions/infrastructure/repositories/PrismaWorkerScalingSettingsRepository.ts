import type { Prisma, PrismaClient } from '@prisma/client';
import { WorkerScalingSettingsConflictError } from '../../../../shared/errors/internal/WorkerScalingErrors';
import type {
  IWorkerScalingSettingsRepository,
  WorkerScalingSettingsRecord,
} from '../../domain/contracts/IWorkerScalingSettingsRepository';
import type { WorkerScalingSettingsPatch } from '../../domain/services/workerScalingSettings';

/** Chave em `platform_settings` (WSCALE-01). */
export const WORKER_SCALING_SETTINGS_KEY = 'worker_scaling';

/**
 * Concorrência otimista por `updatedAt` (WSCALE-06): `null` = cria com `ON CONFLICT DO NOTHING`
 * (linha existente ou corrida = 0 linhas = conflito); data = `updateMany` condicionado; 0 linhas = conflito.
 */
export class PrismaWorkerScalingSettingsRepository implements IWorkerScalingSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(): Promise<WorkerScalingSettingsRecord | null> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: WORKER_SCALING_SETTINGS_KEY } });
    if (!row) return null;
    // `value` cru, mesmo não-objeto: a linha existe e o `updatedAt` real é o que destrava o PUT.
    return { value: row.value, updatedAt: row.updatedAt, updatedById: row.updatedById };
  }

  async save(
    value: WorkerScalingSettingsPatch,
    actorId: string,
    expectedUpdatedAt: Date | null,
  ): Promise<WorkerScalingSettingsRecord> {
    const json = value as Prisma.InputJsonValue;
    if (expectedUpdatedAt === null) {
      // `ON CONFLICT DO NOTHING`: linha existente/corrida vira 0 linhas, sem P2002 nem `prisma:error` no log.
      // Literal ISO com `Z` em `timestamp(3)` ignora o fuso: grava em UTC, como o Prisma no update.
      const rows = await this.prisma.$queryRaw<WorkerScalingSettingsRecord[]>`
        INSERT INTO "platform_settings" ("key", "value", "updatedById", "updatedAt")
        VALUES (${WORKER_SCALING_SETTINGS_KEY}, ${JSON.stringify(value)}::jsonb, ${actorId}, ${new Date().toISOString()}::timestamp(3))
        ON CONFLICT ("key") DO NOTHING
        RETURNING "value", "updatedAt", "updatedById"`;
      const row = rows[0];
      if (!row) throw new WorkerScalingSettingsConflictError();
      return { value: row.value, updatedAt: row.updatedAt, updatedById: row.updatedById };
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
