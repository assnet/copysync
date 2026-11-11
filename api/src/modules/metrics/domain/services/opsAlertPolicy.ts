import { OPS_METRIC, type OpsMetricReading, type OpsMetricSource } from '../OpsMetric';

/** Recurso das leituras `sessions_*` (agregado do cluster). */
export const SESSIONS_CLUSTER_RESOURCE = 'cluster';

/** Limiares de MQ-24. */
export const OPS_ALERT_THRESHOLDS = {
  /** RSS ≥ 80% do limite do container. */
  memoryPct: 80,
  /** CPU ≥ 80% sustentada por 5 min. */
  cpuPct: 80,
  /** Conexões `idle in transaction` simultâneas. */
  idleInTransaction: 3,
  /** p99 do atraso do event loop. */
  eventLoopP99Ms: 200,
} as const;

/** `metric` do alerta `session_occupancy`: percentual derivado no tick, não é métrica gravada. */
export const SESSIONS_OCCUPANCY_ALERT_METRIC = 'sessions_occupancy_pct';

/** Ticks de 60 s que formam os 5 min do streak de CPU. */
export const CPU_STREAK_TICKS = 5;

export type OpsAlertReason = 'memory' | 'cpu' | 'idle_in_transaction' | 'event_loop' | 'session_occupancy';

export interface OpsAlert {
  reason: OpsAlertReason;
  source: OpsMetricSource;
  resource: string;
  metric: string;
  value: number;
  threshold: number;
}

/** Métricas de CPU que alertam: da plataforma e, sem ela, a do Node no heartbeat. */
export const CPU_ALERT_METRICS: readonly string[] = [OPS_METRIC.cpuPct, OPS_METRIC.nodeCpuPct];

/** Chave do histórico de CPU por série. */
export const cpuSeriesKey = (metric: string, resource: string) => `${metric}|${resource}`;

export interface OpsAlertInput {
  /** Leituras do tick atual. */
  current: readonly OpsMetricReading[];
  /** Por série de CPU (`cpuSeriesKey`): valores do ring buffer, mais antigo → mais novo, com o atual. */
  cpuHistory: ReadonlyMap<string, readonly number[]>;
  /** Por série de CPU: média persistida mais recente (janela de 5 min) em `ops_metrics_samples`. */
  cpuPersisted: ReadonlyMap<string, number>;
  /** Fallback `OPS_MEMORY_LIMIT_MB` para RSS dos workers quando a plataforma não dá `memory_pct`. */
  memoryLimitMb: number | null;
  /**
   * Ocupação do cluster (`sessions_connected` ÷ `sessions_capacity` do tick) e o limiar
   * `alertOccupancyRatio` (WSCALE-17). O coletor só preenche com a adoção desligada: com ela o
   * `WorkerCapacityAlertJob` já alerta. Ausente = sem alerta de ocupação.
   */
  sessionOccupancy?: { connected: number; capacity: number; ratio: number };
}

/** CPU ≥ limiar nos últimos 5 ticks do buffer; com buffer curto (dono novo), a média persistida decide. */
export function cpuSustained(history: readonly number[] | undefined, persisted: number | undefined): boolean {
  const h = history ?? [];
  if (h.length >= CPU_STREAK_TICKS) return h.slice(-CPU_STREAK_TICKS).every((v) => v >= OPS_ALERT_THRESHOLDS.cpuPct);
  return persisted !== undefined && persisted >= OPS_ALERT_THRESHOLDS.cpuPct;
}

/**
 * Limiares estourados no tick (MQ-24), no máximo 1 alerta por motivo (o pior recurso). O silêncio
 * de 30 min por motivo fica no job, via lease no banco — nunca em memória. Pura.
 */
export function opsAlerts(input: OpsAlertInput): OpsAlert[] {
  const worst = new Map<OpsAlertReason, OpsAlert>();
  const consider = (reason: OpsAlertReason, r: OpsMetricReading, value: number, threshold: number) => {
    if (!(value >= threshold)) return;
    const prev = worst.get(reason);
    if (prev && prev.value >= value) return;
    worst.set(reason, { reason, source: r.source, resource: r.resource, metric: r.metric, value, threshold });
  };

  const hasPlatformMemory = input.current.some((r) => r.metric === OPS_METRIC.memoryPct);
  for (const r of input.current) {
    switch (r.metric) {
      case OPS_METRIC.memoryPct:
        consider('memory', r, r.value, OPS_ALERT_THRESHOLDS.memoryPct);
        break;
      case OPS_METRIC.workerRssMb:
        if (!hasPlatformMemory && input.memoryLimitMb && input.memoryLimitMb > 0) {
          consider('memory', r, (r.value / input.memoryLimitMb) * 100, OPS_ALERT_THRESHOLDS.memoryPct);
        }
        break;
      case OPS_METRIC.dbIdleInTransaction:
        consider('idle_in_transaction', r, r.value, OPS_ALERT_THRESHOLDS.idleInTransaction);
        break;
      case OPS_METRIC.eventLoopP99Ms:
        consider('event_loop', r, r.value, OPS_ALERT_THRESHOLDS.eventLoopP99Ms);
        break;
      default:
        if (CPU_ALERT_METRICS.includes(r.metric) && r.value >= OPS_ALERT_THRESHOLDS.cpuPct) {
          const k = cpuSeriesKey(r.metric, r.resource);
          if (cpuSustained(input.cpuHistory.get(k), input.cpuPersisted.get(k))) {
            consider('cpu', r, r.value, OPS_ALERT_THRESHOLDS.cpuPct);
          }
        }
    }
  }
  const occ = input.sessionOccupancy;
  // Decide pela razão (0–1, estrita); `value`/`threshold` saem em percentual (0–100, 2 casas), como `memory`.
  const pct = (n: number) => Math.round(n * 10_000) / 100;
  if (occ && occ.capacity > 0 && occ.connected / occ.capacity > occ.ratio) {
    worst.set('session_occupancy', {
      reason: 'session_occupancy',
      source: 'sessions',
      resource: SESSIONS_CLUSTER_RESOURCE,
      metric: SESSIONS_OCCUPANCY_ALERT_METRIC,
      value: pct(occ.connected / occ.capacity),
      threshold: pct(occ.ratio),
    });
  }
  return [...worst.values()];
}
