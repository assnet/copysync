import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { IWorkerHeartbeatRepository } from '../../domain/contracts/IWorkerHeartbeatRepository';
import { HEARTBEAT_MS } from '../../domain/services/sessionAdoptionPolicy';
import { logger } from '../../../../shared/logger/logger';
import type { SessionOccupancy } from '../../application/services/CapacityLimitedLeaseGate';

export interface WorkerHeartbeatJobOptions {
  heartbeats: IWorkerHeartbeatRepository;
  workerId: string;
  /** Papel do processo: `all` | `worker`. */
  role: string;
  /** Teto do processo (`WORKER_MAX_SESSIONS`). */
  maxSessions: number;
  /** Ocupação do processo: sessões com login concluído e logins em andamento (T24). */
  occupancy: () => SessionOccupancy;
  /** Memória residente em MB; padrão `process.memoryUsage().rss`. */
  rssMb?: () => number;
  intervalMs?: number;
  /** CPU acumulada do processo (µs); padrão `process.cpuUsage()`. */
  cpuUsage?: () => NodeJS.CpuUsage;
  /** Relógio monotônico em ms para o tempo de parede entre batimentos; padrão `performance.now()`. */
  monotonicMs?: () => number;
  /** Histograma do atraso do event loop (ns); padrão `monitorEventLoopDelay`. Criado no `start()`. */
  eventLoopDelay?: () => EventLoopDelaySampler;
}

/** Recorte do `IntervalHistogram` do `perf_hooks` usado aqui (valores em ns). */
export interface EventLoopDelaySampler {
  enable(): void;
  disable(): void;
  percentile(p: number): number;
  reset(): void;
}

const NS_PER_MS = 1e6;
/** Resolução do histograma do event loop: 20 ms (padrão do Node é 10). */
const EVENT_LOOP_RESOLUTION_MS = 20;

const defaultEventLoopDelay = (): EventLoopDelaySampler => monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });

/**
 * % de CPU do processo entre duas leituras (MQ-21): delta de user+system sobre o tempo de parede.
 * Passa de 100 quando threads do libuv/V8 trabalham em paralelo. `null` sem intervalo válido.
 */
export function cpuPercent(prev: NodeJS.CpuUsage, cur: NodeJS.CpuUsage, elapsedMs: number): number | null {
  if (!(elapsedMs > 0)) return null;
  const usedUs = cur.user - prev.user + (cur.system - prev.system);
  if (usedUs < 0) return null;
  return (usedUs / (elapsedMs * 1000)) * 100;
}

const defaultRssMb = (): number => Math.round(process.memoryUsage().rss / (1024 * 1024));

/**
 * Batimento do processo em `worker_heartbeats` (ADOPT-10): upsert a cada 20 s; `stop()` apaga a
 * linha. Falha de banco só loga: o batimento seguinte corrige. Ligar só em `worker`/`all` com a flag.
 */
export class WorkerHeartbeatJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly log = logger.child({ module: 'WorkerHeartbeatJob' });
  /** Leitura de CPU do batimento anterior; o delta vira `cpuPct` (sem timer novo). */
  private lastCpu: { usage: NodeJS.CpuUsage; atMs: number } | null = null;
  private eventLoop: EventLoopDelaySampler | null = null;

  constructor(private readonly options: WorkerHeartbeatJobOptions) {}

  start(): void {
    if (this.timer) return;
    try {
      this.eventLoop = (this.options.eventLoopDelay ?? defaultEventLoopDelay)();
      this.eventLoop.enable();
    } catch (err) {
      this.eventLoop = null;
      this.log.warn({ err: (err as Error)?.name }, 'event loop delay monitor unavailable');
    }
    void this.runTick();
    this.timer = setInterval(() => void this.runTick(), this.options.intervalMs ?? HEARTBEAT_MS);
    this.timer.unref();
  }

  /** Para o ticker, espera o batimento em voo e apaga a linha deste worker. Nunca lança. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
    this.eventLoop?.disable();
    this.eventLoop = null;
    try {
      await this.options.heartbeats.remove(this.options.workerId);
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'worker heartbeat remove failed');
    }
  }

  /** Exposto para teste; nunca lança. */
  runTick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.beatOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async beatOnce(): Promise<void> {
    const { heartbeats, workerId, role, maxSessions, occupancy } = this.options;
    try {
      const { sessions, pendingLogins } = occupancy();
      await heartbeats.beat({
        workerId,
        role,
        sessions,
        pendingLogins,
        maxSessions,
        rssMb: (this.options.rssMb ?? defaultRssMb)(),
        cpuPct: this.readCpuPct(),
        eventLoopP99Ms: this.readEventLoopP99Ms(),
      });
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'worker heartbeat failed');
    }
  }

  /** Delta desde o batimento anterior; o 1º batimento só registra a base (`null`). */
  private readCpuPct(): number | null {
    try {
      const usage = (this.options.cpuUsage ?? (() => process.cpuUsage()))();
      const atMs = (this.options.monotonicMs ?? (() => performance.now()))();
      const prev = this.lastCpu;
      this.lastCpu = { usage, atMs };
      return prev ? cpuPercent(prev.usage, usage, atMs - prev.atMs) : null;
    } catch {
      return null;
    }
  }

  /** p99 em ms e zera o histograma: cada batimento mede só a própria janela. */
  private readEventLoopP99Ms(): number | null {
    const h = this.eventLoop;
    if (!h) return null;
    try {
      const p99 = h.percentile(99);
      h.reset();
      return Number.isFinite(p99) && p99 > 0 ? p99 / NS_PER_MS : null;
    } catch {
      return null;
    }
  }
}
