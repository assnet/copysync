import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  FeatureUsageCount,
  FeatureUsageDayRow,
  IFeatureUsageDailyRepository,
} from '../../domain/contracts/IFeatureUsageDailyRepository';
import { dayInZone } from '../../domain/services/featureUsagePeriod';
import { utcInstant } from './featureUsagePeriodSql';

/** Lote da retenção (molde `INFRA_SNAPSHOT_RETENTION_*`): curto, sem lock longo. */
export const FEATURE_USAGE_RETENTION_BATCH_SIZE = 5_000;
/** Teto de lotes por chamada; o resto sai na limpeza seguinte. */
export const FEATURE_USAGE_RETENTION_MAX_BATCHES = 10;
/** Cada lote morre aqui em vez de prender a conexão. */
export const FEATURE_USAGE_RETENTION_STATEMENT_TIMEOUT = '2s';
/** Teto de cada instrução do `replaceDay` (`SET LOCAL`): gravação presa não segura o lease do job. */
export const FEATURE_USAGE_REPLACE_STATEMENT_TIMEOUT = '15s';

export interface PrismaFeatureUsageDailyRepositoryOptions {
  now?: () => Date;
  retentionBatchSize?: number;
  retentionMaxBatches?: number;
}

type Db = Pick<PrismaClient, '$transaction' | '$executeRaw' | '$executeRawUnsafe' | '$queryRaw'>;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const asDay = (day: string): Prisma.Sql => {
  if (!DAY_RE.test(day)) throw new Error(`invalid usage day: ${day}`);
  return Prisma.sql`${day}::date`;
};

/**
 * `feature_usage_daily` (design §4.3–§4.5). Todo `INSERT` grava `"updatedAt"` explícito em UTC (a coluna não tem
 * `DEFAULT` e `CURRENT_TIMESTAMP` dependeria do `TimeZone` da sessão).
 */
export class PrismaFeatureUsageDailyRepository implements IFeatureUsageDailyRepository {
  constructor(
    private readonly prisma: Db,
    private readonly options: PrismaFeatureUsageDailyRepositoryOptions = {},
  ) {}

  private stamp(): Prisma.Sql {
    return utcInstant(this.options.now?.() ?? new Date());
  }

  async replaceDay(day: string, keys: readonly string[], rows: readonly FeatureUsageDayRow[]): Promise<void> {
    const d = asDay(day);
    const allowed = new Set(keys);
    const merged = new Map<string, FeatureUsageDayRow>();
    for (const r of rows) {
      if (!allowed.has(r.featureKey)) throw new Error(`replaceDay row outside keys: ${r.featureKey}`);
      if (!(r.uses > 0)) continue; // zerou: some no DELETE
      const id = `${r.tenantId}\u0000${r.featureKey}\u0000${r.kind}`;
      const prev = merged.get(id);
      merged.set(id, prev ? { ...prev, uses: prev.uses + r.uses } : r);
    }
    if (allowed.size === 0) return;
    const keyList = Prisma.join([...allowed]);
    const kept = [...merged.values()];
    const stamp = this.stamp();

    const del =
      kept.length === 0
        ? this.prisma.$executeRaw`DELETE FROM "feature_usage_daily" WHERE "day" = ${d} AND "featureKey" IN (${keyList})`
        : this.prisma.$executeRaw`
            DELETE FROM "feature_usage_daily"
            WHERE "day" = ${d} AND "featureKey" IN (${keyList})
              AND ("tenantId", "featureKey", "kind") NOT IN (
                SELECT v.t, v.f, v.k FROM (VALUES ${Prisma.join(kept.map((r) => Prisma.sql`(${r.tenantId}, ${r.featureKey}, ${r.kind})`))}) AS v(t, f, k)
              )`;
    const timeout = this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${FEATURE_USAGE_REPLACE_STATEMENT_TIMEOUT}'`);
    if (kept.length === 0) {
      await this.prisma.$transaction([timeout, del]);
      return;
    }
    const values = kept.map((r) => Prisma.sql`(${d}, ${r.tenantId}, ${r.featureKey}, ${r.kind}, ${Math.trunc(r.uses)}::int, ${stamp})`);
    // DELETE e INSERT na mesma transação: falha no meio desfaz tudo e o dia fica como estava
    await this.prisma.$transaction([
      timeout,
      del,
      this.prisma.$executeRaw`
        INSERT INTO "feature_usage_daily" ("day", "tenantId", "featureKey", "kind", "uses", "updatedAt")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("day", "tenantId", "featureKey", "kind") DO UPDATE SET
          "uses" = EXCLUDED."uses", "updatedAt" = EXCLUDED."updatedAt"`,
    ]);
  }

  async increment(count: FeatureUsageCount): Promise<void> {
    const stamp = this.stamp();
    await this.prisma.$executeRaw`
      INSERT INTO "feature_usage_daily" ("day", "tenantId", "featureKey", "kind", "uses", "updatedAt")
      VALUES (${asDay(dayInZone(count.at))}, ${count.tenantId}, ${count.featureKey}, ${count.kind}, 1, ${stamp})
      ON CONFLICT ("day", "tenantId", "featureKey", "kind") DO UPDATE SET
        "uses" = "feature_usage_daily"."uses" + 1, "updatedAt" = EXCLUDED."updatedAt"`;
  }

  async markOnce(count: FeatureUsageCount): Promise<void> {
    const stamp = this.stamp();
    await this.prisma.$executeRaw`
      INSERT INTO "feature_usage_daily" ("day", "tenantId", "featureKey", "kind", "uses", "updatedAt")
      VALUES (${asDay(dayInZone(count.at))}, ${count.tenantId}, ${count.featureKey}, ${count.kind}, 1, ${stamp})
      ON CONFLICT ("day", "tenantId", "featureKey", "kind") DO NOTHING`;
  }

  async oldestDay(keys?: readonly string[]): Promise<string | null> {
    if (keys && keys.length === 0) return null;
    const filter = keys ? Prisma.sql`WHERE "featureKey" IN (${Prisma.join([...keys])})` : Prisma.empty;
    const [row] = await this.prisma.$queryRaw<{ first: string | null }[]>`
      SELECT to_char(MIN("day"), 'YYYY-MM-DD') AS first FROM "feature_usage_daily" ${filter}`;
    return row?.first ?? null;
  }

  /** Lotes de `ctid` com `statement_timeout` por lote (`SET LOCAL` só vale na transação). */
  async purgeBefore(before: string): Promise<number> {
    const bound = asDay(before);
    const batch = this.options.retentionBatchSize ?? FEATURE_USAGE_RETENTION_BATCH_SIZE;
    const maxBatches = this.options.retentionMaxBatches ?? FEATURE_USAGE_RETENTION_MAX_BATCHES;
    let total = 0;
    for (let i = 0; i < maxBatches; i++) {
      const [, deleted] = await this.prisma.$transaction([
        this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${FEATURE_USAGE_RETENTION_STATEMENT_TIMEOUT}'`),
        this.prisma.$executeRaw`
          DELETE FROM "feature_usage_daily" WHERE ctid IN (
            SELECT ctid FROM "feature_usage_daily" WHERE "day" < ${bound} LIMIT ${batch}::int)`,
      ]);
      total += deleted;
      if (deleted < batch) break;
    }
    return total;
  }
}
