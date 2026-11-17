import { Prisma } from '@prisma/client';
import { UsageMetricsReadUnavailableError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import type { FeatureUsageReadInput, FeatureUsageReadResult, IFeatureUsageReader } from '../../domain/contracts/IFeatureUsageReader';
import type { FeatureUsageRow } from '../../domain/services/aggregateFeatureUsage';
import type { FeatureUsageKey, FeatureUsageKind } from '../../domain/services/featureUsageCatalog';
import { dayInZone, daysInclusive, addDays } from '../../domain/services/featureUsagePeriod';
import { runWithinBudget, type UsageReadPrisma } from './featureUsageReadTimeout';

/** Guarda de volume do leitor do agregado (design D3). */
export const DAILY_USAGE_ROW_GUARD = 300_000;
/** Até aqui o leitor devolve linha por dia; acima, agrupa por semana ou mês no SQL. */
export const DAILY_USAGE_DAY_ROWS_MAX_DAYS = 90;

type RawDailyRow = { day: string; tenantId: string; featureKey: string; kind: string; uses: number; activeDays: number; lastDay: string };
type FirstDataRow = { key: string; first: string | null };

/** Mapper: contagens `int` → `number`; dia, bucket e último dia em texto `YYYY-MM-DD`. */
export function toDailyFeatureUsageRow(raw: RawDailyRow): FeatureUsageRow {
  return {
    day: String(raw.day),
    tenantId: raw.tenantId,
    featureKey: raw.featureKey,
    kind: raw.kind as FeatureUsageKind,
    uses: Number(raw.uses),
    activeDays: Number(raw.activeDays),
    lastDay: String(raw.lastDay),
  };
}

/**
 * Leitor do agregado `feature_usage_daily` (P2): mesma forma do leitor sob demanda. Até 90 dias (ou com
 * granularidade `day`) devolve linha por dia; acima, com semana/mês, o SQL agrupa por `date_trunc` (segunda-feira,
 * como `bucketOf`) e devolve `activeDays`/`lastDay` da linha. Sempre filtra por período; uma instrução por vez no
 * orçamento do pedido; guarda de 300 mil linhas.
 */
export class PrismaDailyFeatureUsageReader implements IFeatureUsageReader {
  constructor(
    private readonly prisma: UsageReadPrisma,
    private readonly rowGuard = DAILY_USAGE_ROW_GUARD,
  ) {}

  async read(input: FeatureUsageReadInput): Promise<FeatureUsageReadResult> {
    const keys = [...new Set<FeatureUsageKey>(input.featureKeys)];
    const firstDataDay: FeatureUsageReadResult['firstDataDay'] = {};
    for (const k of keys) firstDataDay[k] = null;
    if (keys.length === 0) return { rows: [], firstDataDay };

    const fromDay = dayInZone(input.from);
    const toDayExclusive = dayInZone(input.toExclusive);
    const days = daysInclusive(fromDay, addDays(toDayExclusive, -1));
    const keyList = Prisma.join(keys);
    const period = Prisma.sql`"day" >= ${fromDay}::date AND "day" < ${toDayExclusive}::date AND "featureKey" IN (${keyList})`;
    const limit = this.rowGuard + 1;

    const grouped = input.granularity !== 'day' && days > DAILY_USAGE_DAY_ROWS_MAX_DAYS;
    const sql = grouped
      ? Prisma.sql`
          SELECT to_char(date_trunc(${Prisma.raw(input.granularity === 'month' ? "'month'" : "'week'")}, "day"::timestamp)::date, 'YYYY-MM-DD') AS day,
                 "tenantId", "featureKey", "kind",
                 sum("uses")::int AS uses, count(DISTINCT "day")::int AS "activeDays",
                 to_char(max("day"), 'YYYY-MM-DD') AS "lastDay"
          FROM "feature_usage_daily"
          WHERE ${period}
          GROUP BY 1, "tenantId", "featureKey", "kind"
          LIMIT ${limit}::int`
      : Prisma.sql`
          SELECT to_char("day", 'YYYY-MM-DD') AS day, "tenantId", "featureKey", "kind",
                 "uses"::int AS uses, 1 AS "activeDays", to_char("day", 'YYYY-MM-DD') AS "lastDay"
          FROM "feature_usage_daily"
          WHERE ${period}
          LIMIT ${limit}::int`;

    const raw = await runWithinBudget<RawDailyRow>(input.budget, this.prisma, sql);
    if (raw.length > this.rowGuard) throw new UsageMetricsReadUnavailableError();
    const rows = raw.map(toDailyFeatureUsageRow);

    const first = await runWithinBudget<FirstDataRow>(
      input.budget,
      this.prisma,
      Prisma.sql`
        SELECT "featureKey" AS key, to_char(MIN("day"), 'YYYY-MM-DD') AS first
        FROM "feature_usage_daily" WHERE "featureKey" IN (${keyList})
        GROUP BY "featureKey"`,
    );
    for (const r of first) if (r.key in firstDataDay) firstDataDay[r.key as FeatureUsageKey] = r.first;
    return { rows, firstDataDay };
  }
}
