import { Prisma, type PrismaClient } from '@prisma/client';
import type { UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import { runWithinBudget } from './featureUsageReadTimeout';
import type { FeatureUsageDropCounts } from '../../domain/contracts/IFeatureUsageRecorder';
import { addDays, dayInZone } from '../../domain/services/featureUsagePeriod';
import type {
  FeatureUsageBackfillStopReason,
  FeatureUsageGroupState,
  FeatureUsageRetryItem,
  IFeatureUsageDropStore,
  FeatureUsageRollupState,
  FeatureUsageTickPatch,
  IFeatureUsageCutoverStore,
  IFeatureUsageRollupStateRepository,
} from '../../domain/contracts/IFeatureUsageRollupStateRepository';

/** Chave em `platform_settings` (sem migration: tabela chave/valor já existe). */
export const FEATURE_USAGE_ROLLUP_SETTINGS_KEY = 'feature_usage_rollup';
/** Cortes do contador: `{ "<featureKey>": "YYYY-MM-DD" }`, cada chave gravada uma única vez. */
export const FEATURE_USAGE_CUTOVER_SETTINGS_KEY = 'feature_usage_cutover';
/** Descartes do contador: `{ "YYYY-MM-DD": { "<featureKey>": n } }`, somados em lote; dia mais velho que 400 dias sai. */
export const FEATURE_USAGE_DROPPED_SETTINGS_KEY = 'feature_usage_dropped';
const DROPPED_KEEP_DAYS = 400;

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

/** Campo só presente quando tem valor (estado antigo continua igual ao lido antes). */
const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

/** Descartes salvos → só dia válido, chave válida e contagem inteira > 0. */
export function parseFeatureUsageDropped(value: unknown): FeatureUsageDropCounts {
  const out: FeatureUsageDropCounts = {};
  for (const [day, keys] of Object.entries(asObject(value))) {
    if (!DAY_RE.test(day)) continue;
    for (const [key, n] of Object.entries(asObject(keys))) {
      if (!KEY_RE.test(key) || typeof n !== 'number' || !Number.isInteger(n) || n <= 0) continue;
      (out[day] ??= {})[key] = n;
    }
  }
  return out;
}

const GROUP_RE = /^[a-z0-9_:.+-]{1,1024}$/;
/** Teto do reprocesso guardado (o use case corta antes; aqui só protege a leitura). */
const RETRY_MAX = 30;
const asCount = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0);
const asReason = (v: unknown): FeatureUsageBackfillStopReason => (v === 'FIRST_DATA' ? 'FIRST_DATA' : 'RETENTION');

function parseGroups(value: unknown): Record<string, FeatureUsageGroupState> | undefined {
  if (value === undefined) return undefined;
  const out: Record<string, FeatureUsageGroupState> = {};
  for (const [id, raw] of Object.entries(asObject(value))) {
    if (!GROUP_RE.test(id)) continue;
    const g = asObject(raw);
    const done = asObject(g['backfillDone']);
    const from = asDay(done['from']);
    out[id] = {
      failureStreak: asCount(g['failureStreak']),
      lastSuccessAt: asInstant(g['lastSuccessAt']),
      backfillCursor: asDay(g['backfillCursor']),
      backfillDone: from ? { from, reason: asReason(done['reason']) } : null,
      backfillFailures: asCount(g['backfillFailures']),
    };
  }
  return out;
}

function parseRetryQueue(value: unknown): FeatureUsageRetryItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: FeatureUsageRetryItem[] = [];
  for (const raw of value) {
    const o = asObject(raw);
    const day = asDay(o['day']);
    const group = o['group'];
    if (day && typeof group === 'string' && GROUP_RE.test(group)) out.push({ day, group });
  }
  return out.slice(-RETRY_MAX);
}

/** Valor salvo → estado; campo ausente ou inválido = vazio (marco só vale com os dois campos). */
export function parseFeatureUsageRollupState(value: unknown, cutoverValue?: unknown, droppedValue?: unknown): FeatureUsageRollupState {
  const o = asObject(value);
  const backfillCompletedAt = asInstant(o['backfillCompletedAt']);
  const backfilledFrom = asDay(o['backfilledFrom']);
  const complete = backfillCompletedAt !== null && backfilledFrom !== null;
  const streak = o['failureStreak'];
  const reason = o['backfillStopReason'];
  const cutovers: Record<string, string> = {};
  for (const [k, v] of Object.entries(asObject(cutoverValue))) {
    const day = asDay(v);
    if (day) cutovers[k] = day;
  }
  return {
    backfillCompletedAt: complete ? backfillCompletedAt : null,
    backfilledFrom: complete ? backfilledFrom : null,
    backfillStopReason: complete ? (reason === 'FIRST_DATA' ? 'FIRST_DATA' : 'RETENTION') : null,
    backfillCursor: asDay(o['backfillCursor']),
    lastSuccessAt: asInstant(o['lastSuccessAt']),
    finalizedThrough: asDay(o['finalizedThrough']),
    failureStreak: typeof streak === 'number' && Number.isInteger(streak) && streak > 0 ? streak : 0,
    cutovers,
    dropped: parseFeatureUsageDropped(droppedValue),
    ...optional('groups', parseGroups(o['groups'])),
    ...optional('retryQueue', parseRetryQueue(o['retryQueue'])),
    ...optional('revisitCursor', asDay(o['revisitCursor']) ?? undefined),
    ...optional(
      'backfillPendingKeys',
      Array.isArray(o['backfillPendingKeys']) ? (o['backfillPendingKeys'] as unknown[]).filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)) : undefined,
    ),
  };
}

type Db = Pick<PrismaClient, 'platformSetting' | '$executeRaw' | '$transaction' | '$executeRawUnsafe' | '$queryRaw'>;
type SettingRow = { key: string; value: unknown };

/**
 * Estado interno do job e cortes do contador (molde `PrismaFeatureAudienceRepository`): upsert com merge `jsonb ||`
 * numa instrução, `"updatedAt"` explícito em UTC. Só o dono do lease grava o estado do job.
 */
export class PrismaFeatureUsageRollupStateRepository
  implements IFeatureUsageRollupStateRepository, IFeatureUsageCutoverStore, IFeatureUsageDropStore
{
  constructor(
    private readonly prisma: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** As três chaves numa instrução. */
  async get(budget?: UsageReadBudget): Promise<FeatureUsageRollupState> {
    const keys = [FEATURE_USAGE_ROLLUP_SETTINGS_KEY, FEATURE_USAGE_CUTOVER_SETTINGS_KEY, FEATURE_USAGE_DROPPED_SETTINGS_KEY];
    const rows: SettingRow[] = budget
      ? await runWithinBudget<SettingRow>(
          budget,
          this.prisma,
          Prisma.sql`SELECT "key", "value" FROM "platform_settings" WHERE "key" IN (${Prisma.join(keys)})`,
        )
      : await this.prisma.platformSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
    const by = new Map(rows.map((r) => [r.key, r.value]));
    return parseFeatureUsageRollupState(
      by.get(FEATURE_USAGE_ROLLUP_SETTINGS_KEY),
      by.get(FEATURE_USAGE_CUTOVER_SETTINGS_KEY),
      by.get(FEATURE_USAGE_DROPPED_SETTINGS_KEY),
    );
  }

  /**
   * Soma os descartes ao que está gravado, numa instrução (`ON CONFLICT` com a soma por dia × chave no SQL): várias
   * réplicas somam sem se sobrescrever. Dia mais velho que 400 dias sai na mesma escrita.
   */
  async addDrops(counts: FeatureUsageDropCounts): Promise<void> {
    const clean = parseFeatureUsageDropped(counts);
    if (Object.keys(clean).length === 0) return;
    const now = this.now();
    const at = now.toISOString();
    const floor = addDays(dayInZone(now), -DROPPED_KEEP_DAYS);
    const patch = JSON.stringify(clean);
    await this.prisma.$executeRaw`
      INSERT INTO "platform_settings" ("key", "value", "updatedById", "updatedAt")
      VALUES (${FEATURE_USAGE_DROPPED_SETTINGS_KEY}, ${patch}::jsonb, NULL, (${at}::timestamptz AT TIME ZONE 'UTC'))
      ON CONFLICT ("key") DO UPDATE SET
        "value" = (
          SELECT COALESCE(jsonb_object_agg(g.d, g.v), '{}'::jsonb) FROM (
            SELECT x.d, jsonb_object_agg(x.k, x.n) AS v FROM (
              SELECT u.d, u.k, SUM(u.n)::int AS n FROM (
                SELECT dd.key AS d, kk.key AS k, (kk.value #>> '{}')::numeric::int AS n
                FROM jsonb_each(CASE WHEN jsonb_typeof("platform_settings"."value") = 'object' THEN "platform_settings"."value" ELSE '{}'::jsonb END) dd
                CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(dd.value) = 'object' THEN dd.value ELSE '{}'::jsonb END) kk
                WHERE jsonb_typeof(kk.value) = 'number'
                UNION ALL
                SELECT dd.key, kk.key, (kk.value #>> '{}')::numeric::int
                FROM jsonb_each(EXCLUDED."value") dd CROSS JOIN LATERAL jsonb_each(dd.value) kk
              ) u
              WHERE u.d >= ${floor}
              GROUP BY u.d, u.k
            ) x GROUP BY x.d
          ) g),
        "updatedAt" = EXCLUDED."updatedAt"`;
  }

  async saveBackfillCursor(day: string): Promise<void> {
    if (!DAY_RE.test(day)) throw new Error(`invalid backfill cursor: ${day}`);
    await this.merge(JSON.stringify({ backfillCursor: day }), false);
  }

  async markBackfillCompleted(marker: {
    completedAt: Date;
    backfilledFrom: string;
    stopReason: FeatureUsageBackfillStopReason;
    pendingKeys?: readonly string[];
  }): Promise<boolean> {
    if (!DAY_RE.test(marker.backfilledFrom)) throw new Error(`invalid backfilledFrom: ${marker.backfilledFrom}`);
    const patch = JSON.stringify({
      backfillCompletedAt: marker.completedAt.toISOString(),
      backfilledFrom: marker.backfilledFrom,
      backfillStopReason: marker.stopReason,
      backfillPendingKeys: [...(marker.pendingKeys ?? [])],
    });
    return (await this.merge(patch, true)) > 0;
  }

  async recordTick(patch: FeatureUsageTickPatch): Promise<void> {
    if (patch.finalizedThrough !== undefined && !DAY_RE.test(patch.finalizedThrough)) {
      throw new Error(`invalid finalizedThrough: ${patch.finalizedThrough}`);
    }
    const body: Record<string, unknown> = { failureStreak: Math.max(0, Math.trunc(patch.failureStreak)) };
    if (patch.lastSuccessAt) body['lastSuccessAt'] = patch.lastSuccessAt.toISOString();
    if (patch.finalizedThrough) body['finalizedThrough'] = patch.finalizedThrough;
    if (patch.groups) {
      body['groups'] = Object.fromEntries(
        Object.entries(patch.groups).map(([id, g]) => [
          id,
          {
            failureStreak: g.failureStreak,
            lastSuccessAt: g.lastSuccessAt?.toISOString() ?? null,
            backfillCursor: g.backfillCursor,
            backfillDone: g.backfillDone,
            backfillFailures: g.backfillFailures,
          },
        ]),
      );
    }
    if (patch.retryQueue) body['retryQueue'] = patch.retryQueue.slice(-RETRY_MAX).map((r) => ({ day: r.day, group: r.group }));
    if (patch.revisitCursor !== undefined) {
      if (!DAY_RE.test(patch.revisitCursor)) throw new Error(`invalid revisitCursor: ${patch.revisitCursor}`);
      body['revisitCursor'] = patch.revisitCursor;
    }
    if (patch.backfillPendingKeys) body['backfillPendingKeys'] = [...patch.backfillPendingKeys];
    await this.merge(JSON.stringify(body), false);
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
