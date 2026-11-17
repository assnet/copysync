import { randomUUID } from 'node:crypto';
import type { IJobLease } from '../../../../shared/jobs/IJobLease';
import { logger } from '../../../../shared/logger/logger';
import type {
  ProcessNextSaverItemInput,
  ProcessNextSaverItemResult,
} from '../../application/use-cases/ProcessNextSaverItemUseCase';
import type { CloseOrphanSaverExtractionsResult } from '../../application/use-cases/CloseOrphanSaverExtractionsUseCase';

/** Lease de cluster da manutenção (1 processo por hora, frequência guardada no banco). */
export const SAVER_MAINTENANCE_LEASE = 'saver-maintenance';
export const SAVER_EXTRACTION_TICK_MS = 2_000;
export const SAVER_MAINTENANCE_EVERY_MS = 60 * 60_000;
/** De quanto em quanto tempo o processo tenta o lease da manutenção (só poupa escrita; quem manda é o lease). */
export const SAVER_MAINTENANCE_CHECK_MS = 60_000;
const DEFAULT_STOP_TIMEOUT_MS = 10_000;

export interface SaverExtractionJobOptions {
  /** Sessões com lease vivo deste processo (filtro de dono no SQL, nunca `listLocalSessionIds`). */
  sessions: { ownedSessionIds(): Promise<string[]> };
  /** `null` quando o engine ainda não subiu: o tick pula a extração. */
  step: () => { execute(input: ProcessNextSaverItemInput): Promise<ProcessNextSaverItemResult> } | null;
  maintenance: { execute(input: { now: Date }): Promise<CloseOrphanSaverExtractionsResult> };
  lease: IJobLease;
  intervalMs?: number;
  maintenanceEveryMs?: number;
  maintenanceCheckMs?: number;
  stopTimeoutMs?: number;
  now?: () => Date;
}

/**
 * Extração do Saver em segundo plano (design.md §4.4). Tick de 2 s, um por vez no processo (sem
 * sobreposição). Cada processo cuida só das próprias sessões; o claim com `SKIP LOCKED` impede trabalho
 * duplicado, então não há singleton de cluster para a extração. A manutenção (itens de sessão excluída,
 * extração órfã) roda no máximo 1×/h no cluster, sob o lease `saver-maintenance`, que não é liberado:
 * vence sozinho. Só é ligado com `SAVER_EXTRACTION_WORKER_ENABLED` em `worker`/`all` (server.ts).
 */
export class SaverExtractionJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private nextMaintenanceCheckAt = 0;
  private readonly ownerId = randomUUID();
  private readonly log = logger.child({ module: 'SaverExtractionJob' });

  constructor(private readonly options: SaverExtractionJobOptions) {}

  get started(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runTick(), this.options.intervalMs ?? SAVER_EXTRACTION_TICK_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.running) return;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
    });
    try {
      // Tick preso não segura o shutdown; a trava do item vence sozinha e ele volta à fila
      if (await Promise.race([this.running.then(() => false), timedOut])) {
        this.log.warn('saver extraction tick still running at stop; giving up waiting');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Exposto para teste; nunca lança. Tick em curso = devolve o mesmo (sem sobreposição). */
  runTick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.tickOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async tickOnce(): Promise<void> {
    const now = this.options.now?.() ?? new Date();
    await this.extract(now);
    await this.maintain(now);
  }

  private async extract(now: Date): Promise<void> {
    try {
      const step = this.options.step();
      if (!step) return;
      const localSessionIds = await this.options.sessions.ownedSessionIds();
      if (localSessionIds.length === 0) return;
      const result = await step.execute({ localSessionIds, now });
      for (const e of result.errors) this.log.warn({ sessionId: e.sessionId, code: e.code }, 'saver extraction step failed');
      if (result.processed > 0) {
        this.log.debug({ outcomes: result.outcomes.map((o) => o.outcome) }, 'saver extraction tick');
      }
    } catch (err) {
      this.log.error({ err: (err as Error)?.name }, 'saver extraction tick failed');
    }
  }

  private async maintain(now: Date): Promise<void> {
    if (now.getTime() < this.nextMaintenanceCheckAt) return;
    this.nextMaintenanceCheckAt = now.getTime() + (this.options.maintenanceCheckMs ?? SAVER_MAINTENANCE_CHECK_MS);
    const until = new Date(now.getTime() + (this.options.maintenanceEveryMs ?? SAVER_MAINTENANCE_EVERY_MS));
    try {
      if (!(await this.options.lease.tryAcquire(SAVER_MAINTENANCE_LEASE, this.ownerId, until, now))) return;
      const r = await this.options.maintenance.execute({ now });
      if (r.processed > 0) {
        this.log.info({ cancelledItems: r.cancelledItems, closedExtractions: r.closedExtractions }, 'saver maintenance');
      }
    } catch (err) {
      this.log.error({ err: (err as Error)?.name }, 'saver maintenance failed');
    }
  }
}
