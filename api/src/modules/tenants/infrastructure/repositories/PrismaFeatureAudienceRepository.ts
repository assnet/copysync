import { prisma } from '../../../../shared/database/prisma.client';
import type { TransactionClient } from '../../../../shared/database/UnitOfWork';
import type { IFeatureAudienceRepository } from '../../domain/contracts/IFeatureAudienceRepository';
import { parseFeatureAudience, type FeatureAudienceKey, type FeatureAudienceSettings } from '../../domain/featureAudience';

/** Chave em `platform_settings` (sem migration: tabela chave/valor já existe). */
export const FEATURE_AUDIENCE_SETTINGS_KEY = 'feature_audience';

/** Com `db` de transação, grava nela (auditoria no mesmo commit). */
export class PrismaFeatureAudienceRepository implements IFeatureAudienceRepository {
  constructor(private readonly db?: TransactionClient) {}

  async get(): Promise<FeatureAudienceSettings> {
    const row = await (this.db ?? prisma).platformSetting.findUnique({ where: { key: FEATURE_AUDIENCE_SETTINGS_KEY }, select: { value: true } });
    return row ? parseFeatureAudience(row.value) : {};
  }

  /**
   * Upsert com merge `jsonb ||` numa instrução: dois admins gravando chaves diferentes não se apagam. Valor salvo
   * que não é objeto vira `{}` antes do merge. Literal ISO com `Z` em `timestamp(3)` grava em UTC (como o Prisma).
   */
  async set(key: FeatureAudienceKey, superAdminOnly: boolean, actorUserId: string): Promise<void> {
    await (this.db ?? prisma).$executeRaw`
      INSERT INTO "platform_settings" ("key", "value", "updatedById", "updatedAt")
      VALUES (${FEATURE_AUDIENCE_SETTINGS_KEY}, jsonb_build_object(${key}::text, ${superAdminOnly}::boolean), ${actorUserId}, ${new Date().toISOString()}::timestamp(3))
      ON CONFLICT ("key") DO UPDATE SET
        "value" = (CASE WHEN jsonb_typeof("platform_settings"."value") = 'object' THEN "platform_settings"."value" ELSE '{}'::jsonb END) || EXCLUDED."value",
        "updatedById" = EXCLUDED."updatedById",
        "updatedAt" = EXCLUDED."updatedAt"`;
  }
}
