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

  constructor(private readonly options: WorkerHeartbeatJobOptions) {}

  start(): void {
    if (this.timer) return;
    void this.runTick();
    this.timer = setInterval(() => void this.runTick(), this.options.intervalMs ?? HEARTBEAT_MS);
    this.timer.unref();
  }

  /** Para o ticker, espera o batimento em voo e apaga a linha deste worker. Nunca lança. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
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
      });
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'worker heartbeat failed');
    }
  }
}
