import type { PrismaClient } from '@prisma/client';
import type { IAiSettingsRepository } from '../../domain/contracts/IAiSettingsRepository';
import { AI_SETTING_KEYS, type AiSettings } from '../../domain/entities/AiSettings';

/** Ausente ou valor não booleano = true (modo ligado por padrão). */
function asFlag(value: unknown): boolean {
  return value === false || value === 'false' ? false : true;
}

export class PrismaAiSettingsRepository implements IAiSettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(): Promise<AiSettings> {
    const rows = await this.prisma.platformSetting.findMany({
      where: { key: { in: Object.values(AI_SETTING_KEYS) } },
      select: { key: true, value: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return {
      platformEnabled: asFlag(byKey.get(AI_SETTING_KEYS.platformEnabled)),
      tenantKeysEnabled: asFlag(byKey.get(AI_SETTING_KEYS.tenantKeysEnabled)),
    };
  }

  async save(settings: AiSettings, updatedById: string): Promise<AiSettings> {
    const write = (key: string, value: boolean) =>
      this.prisma.platformSetting.upsert({
        where: { key },
        create: { key, value, updatedById },
        update: { value, updatedById },
      });
    await this.prisma.$transaction([
      write(AI_SETTING_KEYS.platformEnabled, settings.platformEnabled),
      write(AI_SETTING_KEYS.tenantKeysEnabled, settings.tenantKeysEnabled),
    ]);
    return settings;
  }
}
