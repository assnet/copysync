import type { IOpsMetricsSeriesReader } from '../../domain/contracts/IOpsMetricsSeriesReader';
import { OPS_ALERT_THRESHOLDS } from '../../domain/services/opsAlertPolicy';
import { opsResourceKind, type OpsResourceKind } from '../../domain/services/opsMetricsSeriesPolicy';
import type { IWorkerHeartbeatRepository, WorkerHeartbeat } from '../../../sessions/domain/contracts/IWorkerHeartbeatRepository';
import { WORKER_ALIVE_MS } from '../../../sessions/domain/services/sessionAdoptionPolicy';

/** Janela do "agora": 3 persistências do sampler (5 min cada). */
export const OPS_METRICS_LATEST_WINDOW_MS = 15 * 60 * 1000;

export interface OpsLatestValue {
  resource: string;
  kind: OpsResourceKind;
  metric: string;
  value: number;
  at: Date;
}

export interface OpsTopQuery {
  queryid: string;
  /** Forma normalizada truncada já gravada (`meta.shape`); nunca SQL bruto. */
  shape: string | null;
  totalMs: number;
  meanMs: number | null;
  calls: number | null;
  at: Date;
}

export interface GetOpsMetricsLatestOutput {
  latest: OpsLatestValue[];
  thresholds: typeof OPS_ALERT_THRESHOLDS;
  topQueries: OpsTopQuery[];
  /** Há amostra persistida nos últimos 15 min. */
  samplerActive: boolean;
  workers: WorkerHeartbeat[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Último valor por (resource, metric) nos últimos 15 min, limiares dos alertas (MQ-24), top de
 * consultas do último snapshot e workers vivos. Só tabelas locais; nunca chama a Render.
 */
export class GetOpsMetricsLatestUseCase {
  constructor(
    private readonly reader: Pick<IOpsMetricsSeriesReader, 'latestSince' | 'latestStatementSnapshot'>,
    private readonly heartbeats: Pick<IWorkerHeartbeatRepository, 'listAlive'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<GetOpsMetricsLatestOutput> {
    const since = new Date(this.now().getTime() - OPS_METRICS_LATEST_WINDOW_MS);
    const [rows, statements, workers] = await Promise.all([
      this.reader.latestSince(since),
      this.reader.latestStatementSnapshot(),
      this.heartbeats.listAlive(WORKER_ALIVE_MS),
    ]);
    const latest = rows.map((r) => ({
      resource: r.resource, kind: opsResourceKind(r.source, r.resource, r.metric), metric: r.metric, value: r.value, at: r.at,
    }));
    const topQueries = statements.map((s) => ({
      queryid: s.resource,
      shape: typeof s.meta?.shape === 'string' ? s.meta.shape : null,
      totalMs: s.value,
      meanMs: num(s.meta?.meanMs),
      calls: num(s.meta?.calls),
      at: s.at,
    }));
    const samplerActive = rows.length > 0 || statements.some((s) => s.at.getTime() >= since.getTime());
    return { latest, thresholds: OPS_ALERT_THRESHOLDS, topQueries, samplerActive, workers };
  }
}
