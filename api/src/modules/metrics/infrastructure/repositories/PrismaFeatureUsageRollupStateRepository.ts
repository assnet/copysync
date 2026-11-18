import { Prisma, type PrismaClient } from '@prisma/client';
import type { UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import { runWithinBudget } from './featureUsageReadTimeout';
import type {
  FeatureUsageRollupState,
  IFeatureUsageCutoverStore,
  IFeatureUsageRollupStateRepository,
} from '../../domain/contracts/IFeatureUsageRollupStateRepository';

/** Chave em `platform_settings` (sem migration: tabela chave/valor já existe). */
export const FEATURE_USAGE_ROLLUP_SETTINGS_KEY = 'feature_usage_rollup';
/** Cortes do contador: `{ "<featureKey>": "YYYY-MM-DD" }`, cada chave gravada uma única vez. */
export const FEATURE_USAGE_CUTOVER_SETTINGS_KEY = 'feature_usage_cutover';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[a-z0-9_:.-]{1,64}$/;
const asDay = (v: unknown): string | null => (typeof v === 'string' && DAY_RE.test(v) ? v : null);
const asInstant = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Valor salvo → estado; campo ausente ou inválido = vazio (marco só vale com os dois campos). */
export function parseFeatureUsageRollupState(value: unknown, cutoverValue?: unknown): FeatureUsageRollupState {
  const o = asObject(value);
  const backfillCompletedAt = asInstant(o['backfillCompletedAt']);
  const backfilledFrom = asDay(o['backfilledFrom']);
  const complete = backfillCompletedAt !== null && backfilledFrom !== null;
  const cutovers: Record<string, string> = {};
  for (const [k, v] of Object.entries(asObject(cutoverValue))) {
    const day = asDay(v);
    if (day) cutovers[k] = day;
  }
  return {
    backfillCompletedAt: complete ? backfillCompletedAt : null,
    backfilledFrom: complete ? backfilledFrom : null,
    backfillCursor: asDay(o['backfillCursor']),
    cutovers,
  };
}

type Db = Pick<PrismaClient, 'platformSetting' | '$executeRaw' | '$transaction' | '$executeRawUnsafe' | '$queryRaw'>;
type SettingRow = { key: string; value: unknown };

/**
 * Estado interno do job e cortes do contador (molde `PrismaFeatureAudienceRepository`): upsert com merge `jsonb ||`
 * numa instrução, `"updatedAt"` explícito em UTC. Só o dono do lease grava o estado do job.
 */
export class PrismaFeatureUsageRollupStateRepository implements IFeatureUsageRollupStateRepository, IFeatureUsageCutoverStore {
  constructor(
    private readonly prisma: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** As duas chaves numa instrução. */
  async get(budget?: UsageReadBudget): Promise<FeatureUsageRollupState> {
    const keys = [FEATURE_USAGE_ROLLUP_SETTINGS_KEY, FEATURE_USAGE_CUTOVER_SETTINGS_KEY];
    const rows: SettingRow[] = budget
      ? await runWithinBudget<SettingRow>(
          budget,
          this.prisma,
          Prisma.sql`SELECT "key", "value" FROM "platform_settings" WHERE "key" IN (${Prisma.join(keys)})`,
        )
      : await this.prisma.platformSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
    const by = new Map(rows.map((r) => [r.key, r.value]));
    return parseFeatureUsageRollupState(by.get(FEATURE_USAGE_ROLLUP_SETTINGS_KEY), by.get(FEATURE_USAGE_CUTOVER_SETTINGS_KEY));
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

  /**
   * Grava o corte só se a chave ainda não existe (o `WHERE` do `ON CONFLICT` não reescreve a linha); sem linha
   * devolvida, outro chegou antes e o corte em vigor é relido.
   */
  async claimCutover(featureKey: string, day: string): Promise<string> {
    if (!KEY_RE.test(featureKey)) throw new Error(`invalid cutover key: ${featureKey}`);
    if (!DAY_RE.test(day)) throw new Error(`invalid cutover day: ${day}`);
    const at = this.now().toISOString();
    const patch = JSON.stringify({ [featureKey]: day });
    const [won] = await this.prisma.$queryRaw<{ day: string | null }[]>`
      INSERT INTO "platform_settings" ("key", "value", "updatedById", "updatedAt")
      VALUES (${FEATURE_USAGE_CUTOVER_SETTINGS_KEY}, ${patch}::jsonb, NULL, (${at}::timestamptz AT TIME ZONE 'UTC'))
      ON CONFLICT ("key") DO UPDATE SET
        "value" = (CASE WHEN jsonb_typeof("platform_settings"."value") = 'object' THEN "platform_settings"."value" ELSE '{}'::jsonb END) || EXCLUDED."value",
        "updatedAt" = EXCLUDED."updatedAt"
      WHERE NOT (jsonb_typeof("platform_settings"."value") = 'object' AND "platform_settings"."value" ? ${featureKey})
      RETURNING "value" ->> ${featureKey} AS day`;
    if (won?.day) return won.day;
    const [cur] = await this.prisma.$queryRaw<{ day: string | null }[]>`
      SELECT "value" ->> ${featureKey} AS day FROM "platform_settings" WHERE "key" = ${FEATURE_USAGE_CUTOVER_SETTINGS_KEY}`;
    const stored = asDay(cur?.day);
    if (!stored) throw new Error('cutover not readable');
    return stored;
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
