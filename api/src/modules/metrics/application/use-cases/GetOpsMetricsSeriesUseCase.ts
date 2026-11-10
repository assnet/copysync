import type { IOpsMetricsSeriesReader } from '../../domain/contracts/IOpsMetricsSeriesReader';
import { OPS_METRIC } from '../../domain/OpsMetric';
import {
  OPS_SERIES_MAX_METRICS,
  isOpsMetricName,
  opsBucketMinutes,
  opsResourceKind,
  type OpsResourceKind,
} from '../../domain/services/opsMetricsSeriesPolicy';
import { ValidationError } from '../../../../shared/errors/internal/ResourceErrors';
import { resolveOpsMetricsWindow } from './ListOpsMetricsUseCase';

export interface GetOpsMetricsSeriesInput {
  /** Nomes de `OPS_METRIC`; ausente/vazio = `cpu_pct` + `memory_pct`. */
  metrics?: readonly string[];
  from?: Date;
  to?: Date;
  resource?: string;
}

export interface OpsMetricPoint {
  at: Date;
  avg: number;
  min: number;
  max: number;
}

export interface OpsMetricSeries {
  resource: string;
  kind: OpsResourceKind;
  metric: string;
  points: OpsMetricPoint[];
}

export interface GetOpsMetricsSeriesOutput {
  window: { from: Date; to: Date };
  bucketMinutes: number;
  series: OpsMetricSeries[];
}

export const OPS_SERIES_DEFAULT_METRICS: readonly string[] = [OPS_METRIC.cpuPct, OPS_METRIC.memoryPct];

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Séries agregadas em baldes no servidor para o dashboard super admin (Consumo). Só lê
 * `ops_metrics_samples`; nunca chama a Render. Dado de plataforma, sem tenant.
 */
export class GetOpsMetricsSeriesUseCase {
  constructor(
    private readonly reader: Pick<IOpsMetricsSeriesReader, 'aggregate'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: GetOpsMetricsSeriesInput): Promise<GetOpsMetricsSeriesOutput> {
    const metrics = parseMetrics(input.metrics);
    const window = resolveOpsMetricsWindow(input, this.now());
    const bucketMinutes = opsBucketMinutes(window.to.getTime() - window.from.getTime());
    const rows = await this.reader.aggregate({ metrics, resource: input.resource ?? null, ...window, bucketMinutes });

    const bySeries = new Map<string, OpsMetricSeries>();
    for (const r of rows) {
      const key = `${r.source}|${r.resource}|${r.metric}`;
      let s = bySeries.get(key);
      if (!s) {
        s = { resource: r.resource, kind: opsResourceKind(r.source, r.resource, r.metric), metric: r.metric, points: [] };
        bySeries.set(key, s);
      }
      s.points.push({ at: r.at, avg: round3(r.avg), min: round3(r.min), max: round3(r.max) });
    }
    for (const s of bySeries.values()) s.points.sort((a, b) => a.at.getTime() - b.at.getTime());
    return { window, bucketMinutes, series: [...bySeries.values()] };
  }
}

/** Sem repetição; nome fora de `OPS_METRIC` ou mais de 12 → 400 sem consultar. */
function parseMetrics(raw: readonly string[] | undefined): string[] {
  const list = [...new Set((raw ?? []).map((m) => m.trim()).filter(Boolean))];
  if (list.length === 0) return [...OPS_SERIES_DEFAULT_METRICS];
  if (list.length > OPS_SERIES_MAX_METRICS) throw new ValidationError(`At most ${OPS_SERIES_MAX_METRICS} metrics per request`);
  const unknown = list.filter((m) => !isOpsMetricName(m));
  if (unknown.length > 0) throw new ValidationError('Unknown metric', { metrics: unknown });
  return list;
}
