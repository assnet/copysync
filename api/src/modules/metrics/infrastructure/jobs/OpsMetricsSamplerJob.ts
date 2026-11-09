import { randomUUID } from 'node:crypto';
import type { IJobLease } from '../../../../shared/jobs/IJobLease';
import { logger } from '../../../../shared/logger/logger';
import type { IWorkerHeartbeatRepository } from '../../../sessions/domain/contracts/IWorkerHeartbeatRepository';
import { WORKER_ALIVE_MS } from '../../../sessions/domain/services/sessionAdoptionPolicy';
import type { IPlatformMetricsSource } from '../../domain/contracts/IPlatformMetricsSource';
import type { IDatabaseStatsSource } from '../../domain/contracts/IDatabaseStatsSource';
import type { IOpsMetricsSampleRepository } from '../../domain/contracts/IOpsMetricsSampleRepository';
import { OPS_METRIC, type OpsMetricReading } from '../../domain/OpsMetric';
import { aggregateOpsMetrics } from '../../domain/services/aggregateOpsMetrics';
import {
  CPU_ALERT_METRICS,
  CPU_STREAK_TICKS,
  OPS_ALERT_THRESHOLDS,
  cpuSeriesKey,
  opsAlerts,
  type OpsAlert,
} from '../../domain/services/opsAlertPolicy';
import { OpsMetricsRingBuffer } from '../../application/services/OpsMetricsRingBuffer';

export const OPS_SAMPLER_LEASE = 'ops-metrics-sampler';
export const OPS_ALERT_LEASE_PREFIX = 'ops-alert:';
export const OPS_SAMPLER_TICK_MS = 60_000;
/**
 * < intervalo: `PrismaJobLease` só readquire depois de vencer, então o dono retoma no tick
 * seguinte; com TTL ≥ intervalo a amostragem viraria o período do TTL. Solto no `stop()`.
 */
export const OPS_SAMPLER_LEASE_TTL_MS = 45_000;
/**
 * Teto da coleta do tick (fontes lentas não seguram o tick): < TTL do lease. Tick que estoura
 * descarta a leitura (sem buffer, persist nem alerta). O `persist` roda com o lease renovado.
 */
export const OPS_TICK_TIMEOUT_MS = 30_000;
/** 1 linha por série a cada 5 ticks (5 min). */
export const OPS_PERSIST_EVERY_TICKS = 5;
export const OPS_RETENTION_MS = 7 * 24 * 3_600_000;
/** Silêncio por motivo, cluster-wide: o lease não é solto e vence sozinho. */
export const OPS_ALERT_SILENCE_MS = 30 * 60_000;

export interface OpsMetricsSamplerJobOptions {
  lease: IJobLease;
  samples: IOpsMetricsSampleRepository;
  heartbeats: IWorkerHeartbeatRepository;
  /** `null` sem `RENDER_API_KEY`/`RENDER_RESOURCE_IDS`: só Postgres e workers. */
  platform: IPlatformMetricsSource | null;
  database: IDatabaseStatsSource;
  /** `OPS_MEMORY_LIMIT_MB`: fallback de RSS quando a plataforma não dá `memory_pct`. */
  memoryLimitMb?: number | null;
  intervalMs?: number;
  /** Teste: teto da coleta (padrão `OPS_TICK_TIMEOUT_MS`). */
  tickTimeoutMs?: number;
  now?: () => Date;
}

/**
 * Amostrador de recursos (MQ-22..24), só no `worker`/`all` e com `OPS_METRICS_SAMPLER_ENABLED`.
 * Tick de 60 s sob o lease `ops-metrics-sampler` (1 processo amostra no cluster): lê Render,
 * Postgres e `worker_heartbeats` em paralelo (falha de uma fonte só loga; coleta limitada a 30 s),
 * guarda no ring buffer, persiste a cada 5 ticks com o lease renovado (perdeu → não grava) e apaga
 * > 7 dias no mesmo tick, e avalia limiares com silêncio por lease.
 * Nunca roda em requisição; nunca lança.
 */
export class OpsMetricsSamplerJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private stopped = false;
  private ticksSincePersist = 0;
  private readonly buffer = new OpsMetricsRingBuffer();
  private readonly ownerId = randomUUID();
  private readonly log = logger.child({ module: 'OpsMetricsSamplerJob' });

  constructor(private readonly options: OpsMetricsSamplerJobOptions) {}

  private get intervalMs(): number {
    return this.options.intervalMs ?? OPS_SAMPLER_TICK_MS;
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.runTick(), this.intervalMs);
    this.timer.unref();
  }

  /** Para o timer, cancela a leitura da Render em voo, espera o tick e solta o lease. Nunca lança. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.abort?.abort();
    await this.running?.catch(() => undefined);
    try {
      await this.options.lease.release(OPS_SAMPLER_LEASE, this.ownerId);
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'ops metrics lease release failed');
    }
  }

  /** Exposto para teste; nunca lança. */
  runTick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.tickOnce()
      .catch((err) => this.log.warn({ err: (err as Error)?.name }, 'ops metrics tick failed'))
      .finally(() => {
        this.running = null;
        this.abort = null;
      });
    return this.running;
  }

  private async tickOnce(): Promise<void> {
    if (this.stopped) return;
    const { lease } = this.options;
    const now = this.options.now?.() ?? new Date();
    const owner = await lease.tryAcquire(OPS_SAMPLER_LEASE, this.ownerId, new Date(now.getTime() + OPS_SAMPLER_LEASE_TTL_MS), now);
    if (!owner) {
      // Outro processo amostra: o buffer daqui ficaria com buraco
      this.buffer.clear();
      this.ticksSincePersist = 0;
      return;
    }

    const deadline = AbortSignal.timeout(this.options.tickTimeoutMs ?? OPS_TICK_TIMEOUT_MS);
    const readings = await this.collect(deadline);
    if (this.stopped) return;
    if (deadline.aborted) {
      this.log.warn('ops metrics tick over budget, sample dropped');
      return;
    }
    this.buffer.push({ at: now, readings });
    this.ticksSincePersist += 1;
    if (this.ticksSincePersist >= OPS_PERSIST_EVERY_TICKS) {
      this.ticksSincePersist = 0;
      if (!(await this.renewLease())) {
        // Outro processo virou dono no meio do tick: não grava janela duplicada
        this.log.warn('ops metrics lease lost before persist, skipped');
        this.buffer.clear();
        return;
      }
      await this.persist(now);
    }
    await this.evaluateAlerts(now, readings);
  }

  /**
   * Renova o lease antes do `persist` (o tick pode ter passado do TTL): `tryAcquire` só pega
   * lease vencido, então solta o próprio e readquire. Se outro processo for dono, o `release`
   * não apaga e o `tryAcquire` falha → `false`. Falha de banco também conta como perda.
   */
  private async renewLease(): Promise<boolean> {
    const { lease } = this.options;
    try {
      await lease.release(OPS_SAMPLER_LEASE, this.ownerId);
      const now = this.options.now?.() ?? new Date();
      return await lease.tryAcquire(OPS_SAMPLER_LEASE, this.ownerId, new Date(now.getTime() + OPS_SAMPLER_LEASE_TTL_MS), now);
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'ops metrics lease renew failed');
      return false;
    }
  }

  private async collect(deadline: AbortSignal): Promise<OpsMetricReading[]> {
    const { platform, database, heartbeats } = this.options;
    this.abort = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, deadline]);
    // Fontes sem sinal (Postgres, heartbeats) também param no teto do tick
    const bounded = <T>(p: Promise<T>): Promise<T> => Promise.race([
      p,
      new Promise<never>((_, reject) => {
        const fail = () => reject(new Error('ops metrics tick timeout'));
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      }),
    ]);
    const sources = [
      ['render', bounded(platform ? platform.read(signal) : Promise.resolve([]))],
      ['postgres', bounded(database.read())],
      ['worker', bounded(heartbeats.listAlive(WORKER_ALIVE_MS).then(workerReadings))],
    ] as const;
    const settled = await Promise.allSettled(sources.map(([, p]) => p));
    const out: OpsMetricReading[] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') out.push(...r.value);
      else this.log.warn({ source: sources[i]![0], err: (r.reason as Error)?.name }, 'ops metrics source failed');
    });
    return out;
  }

  /** Agrega a janela de 5 min do buffer, grava e aplica a retenção de 7 dias. Só loga em falha. */
  private async persist(now: Date): Promise<void> {
    const { samples } = this.options;
    const window = this.buffer.since(new Date(now.getTime() - OPS_PERSIST_EVERY_TICKS * this.intervalMs + 1));
    try {
      await samples.insertMany(aggregateOpsMetrics(window, now));
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'ops metrics persist failed');
    }
    try {
      const deleted = await samples.deleteOlderThan(new Date(now.getTime() - OPS_RETENTION_MS));
      if (deleted > 0) this.log.debug({ deleted }, 'ops metrics retention');
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'ops metrics retention failed');
    }
  }

  private async evaluateAlerts(now: Date, current: OpsMetricReading[]): Promise<void> {
    const recent = this.buffer.since(new Date(now.getTime() - CPU_STREAK_TICKS * this.intervalMs + 1));
    const cpuHistory = new Map<string, number[]>();
    for (const tick of recent) {
      for (const r of tick.readings) {
        if (!CPU_ALERT_METRICS.includes(r.metric)) continue;
        const k = cpuSeriesKey(r.metric, r.resource);
        cpuHistory.set(k, [...(cpuHistory.get(k) ?? []), r.value]);
      }
    }
    const cpuPersisted = await this.persistedCpu(now, current, cpuHistory);
    const alerts = opsAlerts({ current, cpuHistory, cpuPersisted, memoryLimitMb: this.options.memoryLimitMb ?? null });
    for (const alert of alerts) await this.raise(alert, now);
  }

  /**
   * Dono novo (buffer < 5 ticks) com CPU alta: o streak sai da última média persistida (6 min).
   * Só consulta quando há CPU acima do limiar sem histórico suficiente.
   */
  private async persistedCpu(now: Date, current: OpsMetricReading[], history: Map<string, number[]>): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const needed = current.filter(
      (r) => CPU_ALERT_METRICS.includes(r.metric) && r.value >= OPS_ALERT_THRESHOLDS.cpuPct
        && (history.get(cpuSeriesKey(r.metric, r.resource))?.length ?? 0) < CPU_STREAK_TICKS,
    );
    const metrics = [...new Set(needed.map((r) => r.metric))];
    const since = new Date(now.getTime() - (OPS_PERSIST_EVERY_TICKS + 1) * this.intervalMs);
    for (const metric of metrics) {
      try {
        for (const s of await this.options.samples.listSince(metric, since)) {
          const k = cpuSeriesKey(s.metric, s.resource);
          if (!out.has(k)) out.set(k, s.value); // mais nova primeiro
        }
      } catch (err) {
        this.log.warn({ err: (err as Error)?.name }, 'ops metrics cpu history failed');
      }
    }
    return out;
  }

  /** 1 log por motivo a cada 30 min no cluster (lease `ops-alert:<reason>`). Sem e-mail (D5). */
  private async raise(alert: OpsAlert, now: Date): Promise<void> {
    try {
      const until = new Date(now.getTime() + OPS_ALERT_SILENCE_MS);
      if (!(await this.options.lease.tryAcquire(`${OPS_ALERT_LEASE_PREFIX}${alert.reason}`, this.ownerId, until, now))) return;
      this.log.warn(alert, 'ops metrics alert');
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name, reason: alert.reason }, 'ops metrics alert lease failed');
    }
  }
}

/** RSS, CPU do Node e p99 do event loop de cada worker vivo (T16). */
function workerReadings(rows: Awaited<ReturnType<IWorkerHeartbeatRepository['listAlive']>>): OpsMetricReading[] {
  const out: OpsMetricReading[] = [];
  for (const w of rows) {
    const base = { source: 'worker' as const, resource: w.workerId, kind: 'gauge' as const };
    out.push({ ...base, metric: OPS_METRIC.workerRssMb, value: w.rssMb });
    if (w.cpuPct != null) out.push({ ...base, metric: OPS_METRIC.nodeCpuPct, value: w.cpuPct });
    if (w.eventLoopP99Ms != null) out.push({ ...base, metric: OPS_METRIC.eventLoopP99Ms, value: w.eventLoopP99Ms });
  }
  return out;
}
