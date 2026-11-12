import { Prisma, type PrismaClient } from '@prisma/client';
import {
  INFRA_COST_LIVE_SESSIONS_WINDOW_MS,
  INFRA_COST_LIVE_WORKER_WINDOW_MS,
  type IInfraCostLiveReader,
  type InfraCostLiveReading,
} from '../../domain/contracts/IInfraCostLiveReader';
import { OPS_METRIC } from '../../domain/OpsMetric';
import { opsWorkerServiceId } from '../../domain/services/opsMetricsSeriesPolicy';
import { WORKER_INSTANCE_CURRENT_SLACK_MS } from '../../domain/services/workerInstancesPolicy';
import { OPS_READ_STATEMENT_TIMEOUT } from './PrismaOpsMetricsSampleRepository';
import { translateInfraCostReadTimeout } from './infraCostReadTimeout';

/** ISO (UTC) → `timestamp` sem fuso, explícito: independe do `TimeZone` da sessão. */
const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

type SessionRow = { metric: string; value: number; at_s: number };
type WorkerRow = { suffixed: number; bare: number };

/**
 * `ops_metrics_samples` → foto do momento (COST-04). Instância atual = mesma regra de
 * `matchWorkerInstances`: CPU/RAM com amostra mais nova a até 2 min da mais nova do serviço (deploy não soma duas).
 * `workerServiceId` cru (env); fora do formato
 * `srv-...` = sem leitura de instâncias. As duas consultas na mesma transação com `statement_timeout` 2 s;
 * estouro → 503 `INFRA_COST_READ_UNAVAILABLE`.
 */
export class PrismaInfraCostLiveReader implements IInfraCostLiveReader {
  private readonly serviceId: string | null;

  constructor(private readonly prisma: PrismaClient, workerServiceId: string | null | undefined) {
    this.serviceId = opsWorkerServiceId(workerServiceId);
  }

  read(now: Date): Promise<InfraCostLiveReading> {
    return translateInfraCostReadTimeout(() => this.query(now));
  }

  async workerInstancesInHour(start: Date, end: Date): Promise<number | null> {
    const id = this.serviceId;
    if (!id) return null;
    const [, rows] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${OPS_READ_STATEMENT_TIMEOUT}'`),
      this.prisma.$queryRaw<{ n: number | null }[]>`
        WITH b AS (
          SELECT date_trunc('minute', "at") AS m,
            count(DISTINCT "resource") FILTER (WHERE "resource" <> ${id}) AS suffixed,
            count(*) FILTER (WHERE "resource" = ${id}) AS bare
          FROM "ops_metrics_samples"
          WHERE "source" = 'render' AND "metric" IN (${OPS_METRIC.cpuPct}, ${OPS_METRIC.memoryPct})
            AND ("resource" = ${id} OR left("resource", ${id.length + 1}::int) = ${`${id}-`})
            AND "at" >= ${utc(start)} AND "at" < ${utc(end)}
          GROUP BY 1
        )
        SELECT round(avg(CASE WHEN suffixed > 0 THEN suffixed ELSE 1 END))::int AS n FROM b`,
    ]);
    const n = rows[0]?.n;
    return n == null || n <= 0 ? null : Number(n);
  }

  private async query(now: Date): Promise<InfraCostLiveReading> {
    const sessionsSince = new Date(now.getTime() - INFRA_COST_LIVE_SESSIONS_WINDOW_MS);
    const workerSince = new Date(now.getTime() - INFRA_COST_LIVE_WORKER_WINDOW_MS);
    const id = this.serviceId;
    const [, sessions, workers] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${OPS_READ_STATEMENT_TIMEOUT}'`),
      this.prisma.$queryRaw<SessionRow[]>`
        SELECT DISTINCT ON ("metric") "metric", "value", extract(epoch FROM "at")::float8 AS at_s
        FROM "ops_metrics_samples"
        WHERE "source" = 'sessions' AND "resource" = 'cluster'
          AND "metric" IN (${OPS_METRIC.sessionsConnected}, ${OPS_METRIC.sessionsCapacity})
          AND "at" >= ${utc(sessionsSince)} AND "at" <= ${utc(now)}
        ORDER BY "metric", "at" DESC, "id" DESC`,
      id
        ? this.prisma.$queryRaw<WorkerRow[]>`
          WITH own AS (
            SELECT "resource", max("at") AS last_at FROM "ops_metrics_samples"
            WHERE "source" = 'render' AND "metric" IN (${OPS_METRIC.cpuPct}, ${OPS_METRIC.memoryPct})
              AND ("resource" = ${id} OR left("resource", ${id.length + 1}::int) = ${`${id}-`})
              AND "at" >= ${utc(workerSince)} AND "at" <= ${utc(now)}
            GROUP BY "resource"
          ), cur AS (
            SELECT "resource" FROM own
            WHERE last_at >= (SELECT max(last_at) FROM own) - make_interval(secs => ${WORKER_INSTANCE_CURRENT_SLACK_MS / 1000}::int)
          )
          SELECT count(*) FILTER (WHERE "resource" <> ${id})::int AS suffixed,
                 count(*) FILTER (WHERE "resource" = ${id})::int AS bare
          FROM cur`
        : this.prisma.$queryRaw<WorkerRow[]>`SELECT 0::int AS suffixed, 0::int AS bare`,
    ]);
    const connected = sessions.find((r) => r.metric === OPS_METRIC.sessionsConnected) ?? null;
    const capacity = sessions.find((r) => r.metric === OPS_METRIC.sessionsCapacity) ?? null;
    const w = workers[0] ?? { suffixed: 0, bare: 0 };
    return {
      sessionsConnected: connected ? connected.value : null,
      sessionsCapacity: capacity ? capacity.value : null,
      // Horário da linha de conectadas (a das não alocadas), não da mais nova entre as duas métricas.
      sessionsSampledAt: connected ? new Date(connected.at_s * 1000) : null,
      workerInstances: w.suffixed > 0 ? w.suffixed : w.bare > 0 ? 1 : null,
    };
  }
}
