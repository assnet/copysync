import type { ListOpsMetricsOutput } from '../../application/use-cases/ListOpsMetricsUseCase';

/** Datas em ISO; heartbeat sem `cpuPct`/`eventLoopP99Ms` (imagem antiga ou 1º batimento) vira `null`. */
export function presentOpsMetrics(out: ListOpsMetricsOutput) {
  return {
    window: { from: out.window.from.toISOString(), to: out.window.to.toISOString() },
    samples: out.samples.map((s) => ({ ...s, at: s.at.toISOString() })),
    nextCursor: out.nextCursor,
    workers: out.workers.map((w) => ({
      workerId: w.workerId,
      role: w.role,
      sessions: w.sessions,
      pendingLogins: w.pendingLogins,
      maxSessions: w.maxSessions,
      rssMb: w.rssMb,
      cpuPct: w.cpuPct ?? null,
      eventLoopP99Ms: w.eventLoopP99Ms ?? null,
      seenAt: w.seenAt.toISOString(),
    })),
  };
}
