import type { ListOpsMetricsOutput } from '../../application/use-cases/ListOpsMetricsUseCase';
import type { GetOpsMetricsSeriesOutput } from '../../application/use-cases/GetOpsMetricsSeriesUseCase';
import type { GetOpsMetricsLatestOutput } from '../../application/use-cases/GetOpsMetricsLatestUseCase';
import type { WorkerHeartbeat } from '../../../sessions/domain/contracts/IWorkerHeartbeatRepository';

/** Datas em ISO; heartbeat sem `cpuPct`/`eventLoopP99Ms` (imagem antiga ou 1º batimento) vira `null`. */
export function presentOpsMetrics(out: ListOpsMetricsOutput) {
  return {
    window: { from: out.window.from.toISOString(), to: out.window.to.toISOString() },
    samples: out.samples.map((s) => ({ ...s, at: s.at.toISOString() })),
    nextCursor: out.nextCursor,
    workers: out.workers.map(presentWorker),
  };
}

/** Heartbeat sem `cpuPct`/`eventLoopP99Ms` (imagem antiga ou 1º batimento) vira `null`. */
export function presentWorker(w: WorkerHeartbeat) {
  return {
    workerId: w.workerId,
    role: w.role,
    sessions: w.sessions,
    pendingLogins: w.pendingLogins,
    maxSessions: w.maxSessions,
    rssMb: w.rssMb,
    cpuPct: w.cpuPct ?? null,
    eventLoopP99Ms: w.eventLoopP99Ms ?? null,
    seenAt: w.seenAt.toISOString(),
  };
}

export function presentOpsMetricsSeries(out: GetOpsMetricsSeriesOutput) {
  return {
    window: { from: out.window.from.toISOString(), to: out.window.to.toISOString() },
    bucketMinutes: out.bucketMinutes,
    series: out.series.map((s) => ({
      resource: s.resource,
      kind: s.kind,
      metric: s.metric,
      points: s.points.map((p) => ({ at: p.at.toISOString(), avg: p.avg, min: p.min, max: p.max })),
    })),
  };
}

export function presentOpsMetricsLatest(out: GetOpsMetricsLatestOutput) {
  return {
    latest: out.latest.map((l) => ({ resource: l.resource, kind: l.kind, metric: l.metric, value: l.value, at: l.at.toISOString() })),
    thresholds: { ...out.thresholds },
    topQueries: out.topQueries.map((q) => ({ ...q, at: q.at.toISOString() })),
    samplerActive: out.samplerActive,
    workers: out.workers.map(presentWorker),
  };
}
