import type { Prisma, PrismaClient } from '@prisma/client';
import { InfraCostSettingsConflictError } from '../../../../shared/errors/internal/InfraCostErrors';
import type {
  IInfraCostSettingsRepository,
  InfraCostSettingsRecord,
} from '../../domain/contracts/IInfraCostSettingsRepository';
import type { InfraCostSettings } from '../../domain/services/infraCostSettings';

/** Chave em `platform_settings` (COST-01). */
export const INFRA_COST_SETTINGS_KEY = 'infra_costs';

/**
 * Concorrência otimista por `updatedAt` (COST-03), mesmo padrão da escala dos workers:
 * `null` = cria com `ON CONFLICT DO NOTHING` (linha existente ou corrida = 0 linhas = conflito);
 * data = `updateMany` condicionado; 0 linhas = conflito. Linha inválida sai crua: o default
 * vem de `resolveInfraCostSettings`, e o `updatedAt` real é o que destrava o PUT.
 */
export class PrismaInfraCostSettingsRepository implements IInfraCostSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(): Promise<InfraCostSettingsRecord | null> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: INFRA_COST_SETTINGS_KEY } });
    if (!row) return null;
    return { value: row.value, updatedAt: row.updatedAt, updatedById: row.updatedById };
  }

  async save(
    value: InfraCostSettings,
    actorId: string,
    expectedUpdatedAt: Date | null,
  ): Promise<InfraCostSettingsRecord> {
    if (expectedUpdatedAt === null) {
      // Literal ISO com `Z` em `timestamp(3)` ignora o fuso: grava em UTC, como o Prisma no update.
      const rows = await this.prisma.$queryRaw<InfraCostSettingsRecord[]>`
        INSERT INTO "platform_settings" ("key", "value", "updatedById", "updatedAt")
        VALUES (${INFRA_COST_SETTINGS_KEY}, ${JSON.stringify(value)}::jsonb, ${actorId}, ${new Date().toISOString()}::timestamp(3))
        ON CONFLICT ("key") DO NOTHING
        RETURNING "value", "updatedAt", "updatedById"`;
      const row = rows[0];
      if (!row) throw new InfraCostSettingsConflictError();
      return { value: row.value, updatedAt: row.updatedAt, updatedById: row.updatedById };
    }
    // Sempre depois do esperado: duas gravações no mesmo ms não podem repetir o `updatedAt`.
    const updatedAt = new Date(Math.max(Date.now(), expectedUpdatedAt.getTime() + 1));
    const { count } = await this.prisma.platformSetting.updateMany({
      where: { key: INFRA_COST_SETTINGS_KEY, updatedAt: expectedUpdatedAt },
      data: { value: value as unknown as Prisma.InputJsonValue, updatedById: actorId, updatedAt },
    });
    if (count === 0) throw new InfraCostSettingsConflictError();
    return { value, updatedAt, updatedById: actorId };
  }
}
