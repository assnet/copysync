import { Prisma, type PrismaClient } from '@prisma/client';
import type { UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import { runWithinBudget } from './featureUsageReadTimeout';
import type {
  FeatureUsageRollupState,
  IFeatureUsageRollupStateRepository,
} from '../../domain/contracts/IFeatureUsageRollupStateRepository';

/** Chave em `platform_settings` (sem migration: tabela chave/valor já existe). */
export const FEATURE_USAGE_ROLLUP_SETTINGS_KEY = 'feature_usage_rollup';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const asDay = (v: unknown): string | null => (typeof v === 'string' && DAY_RE.test(v) ? v : null);
const asInstant = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Valor salvo → estado; campo ausente ou inválido = `null` (marco só vale com os dois campos). */
export function parseFeatureUsageRollupState(value: unknown): FeatureUsageRollupState {
  const o = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const backfillCompletedAt = asInstant(o['backfillCompletedAt']);
  const backfilledFrom = asDay(o['backfilledFrom']);
  const complete = backfillCompletedAt !== null && backfilledFrom !== null;
  return {
    backfillCompletedAt: complete ? backfillCompletedAt : null,
    backfilledFrom: complete ? backfilledFrom : null,
    backfillCursor: asDay(o['backfillCursor']),
  };
}

type Db = Pick<PrismaClient, 'platformSetting' | '$executeRaw' | '$transaction' | '$executeRawUnsafe' | '$queryRaw'>;

/**
 * Estado interno do job (molde `PrismaFeatureAudienceRepository`): upsert com merge `jsonb ||` numa instrução,
 * `"updatedAt"` explícito em UTC. Só o dono do lease de backfill grava.
 */
export class PrismaFeatureUsageRollupStateRepository implements IFeatureUsageRollupStateRepository {
  constructor(
    private readonly prisma: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(budget?: UsageReadBudget): Promise<FeatureUsageRollupState> {
    if (budget) {
      const [hit] = await runWithinBudget<{ value: unknown }>(
        budget,
        this.prisma,
        Prisma.sql`SELECT "value" FROM "platform_settings" WHERE "key" = ${FEATURE_USAGE_ROLLUP_SETTINGS_KEY}`,
      );
      return parseFeatureUsageRollupState(hit?.value);
    }
    const row = await this.prisma.platformSetting.findUnique({ where: { key: FEATURE_USAGE_ROLLUP_SETTINGS_KEY }, select: { value: true } });
    return parseFeatureUsageRollupState(row?.value);
  }

  async saveBackfillCursor(day: string): Promise<void> {
    if (!DAY_RE.test(day)) throw new Error(`invalid backfill cursor: ${day}`);
    await this.merge(JSON.stringify({ backfillCursor: day }), false);
  }

  async markBackfillCompleted(marker: { completedAt: Date; backfilledFrom: string }): Promise<boolean> {
    if (!DAY_RE.test(marker.backfilledFrom)) throw new Error(`invalid backfilledFrom: ${marker.backfilledFrom}`);
    const patch = JSON.stringify({ backfillCompletedAt: marker.completedAt.toISOString(), backfilledFrom: marker.backfilledFrom });
    return (await this.merge(patch, true)) > 0;
  }

  /** `onlyOnce`: não regrava quando o marco já existe (a linha fica intacta). */
  private merge(patch: string, onlyOnce: boolean): Promise<number> {
    const at = this.now().toISOString();
    return onlyOnce
      ? this.prisma.$executeRaw`
          INSERT INTO "platform_settings" ("key", "value", "updatedById", "updatedAt")
          VALUES (${FEATURE_USAGE_ROLLUP_SETTINGS_KEY}, ${patch}::jsonb, NULL, (${at}::timestamptz AT TIME ZONE 'UTC'))
          ON CONFLICT ("key") DO UPDATE SET
            "value" = (CASE WHEN jsonb_typeof("platform_settings"."value") = 'object' THEN "platform_settings"."value" ELSE '{}'::jsonb END) || EXCLUDED."value",
            "updatedAt" = EXCLUDED."updatedAt"
          WHERE NOT (jsonb_typeof("platform_settings"."value") = 'object' AND "platform_settings"."value" ? 'backfillCompletedAt')`
      : this.prisma.$executeRaw`
          INSERT INTO "platform_settings" ("key", "value", "updatedById", "updatedAt")
          VALUES (${FEATURE_USAGE_ROLLUP_SETTINGS_KEY}, ${patch}::jsonb, NULL, (${at}::timestamptz AT TIME ZONE 'UTC'))
          ON CONFLICT ("key") DO UPDATE SET
            "value" = (CASE WHEN jsonb_typeof("platform_settings"."value") = 'object' THEN "platform_settings"."value" ELSE '{}'::jsonb END) || EXCLUDED."value",
            "updatedAt" = EXCLUDED."updatedAt"`;
  }
}
