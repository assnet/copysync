import { randomUUID } from 'node:crypto';
import type { IJobLease } from '../../../../shared/jobs/IJobLease';
import type { IWorkerHeartbeatRepository } from '../../domain/contracts/IWorkerHeartbeatRepository';
import type { ISessionAdoptionRepository } from '../../domain/contracts/ISessionAdoptionRepository';
import {
  ALERT_TICK_MS,
  AWAITING_ALERT_MS,
  WORKER_ALIVE_MS,
  capacityAlertReason,
  type CapacityAlertReason,
} from '../../domain/services/sessionAdoptionPolicy';
import { logger } from '../../../../shared/logger/logger';

export const CAPACITY_ALERT_LEASE = 'worker-capacity-alert';
export const CAPACITY_ALERT_EMAIL_LEASE = 'worker-capacity-alert-email';

/** Cooldown do e-mail: o lease não é solto e vence sozinho. */
const EMAIL_COOLDOWN_MS = 30 * 60_000;
/**
 * Lease do tick um pouco menor que o intervalo: não é solto (trava de frequência no cluster, 1
 * alerta por minuto) e o dono atual o readquire no tick seguinte sem perder a vez por deriva.
 */
const ALERT_LEASE_TTL_MS = ALERT_TICK_MS - 1_000;

export interface CapacityAlert {
  reason: CapacityAlertReason;
  workers: number;
  sessions: number;
  maxSessions: number;
  awaiting: number;
}

/**
 * Envio do e-mail ao super-admin (D5). Sem template `WORKER_CAPACITY_ALERT` na central o e-mail
 * fica adiado: quem monta não passa `notifier` e o alerta é só o log `warn`.
 */
export interface ICapacityAlertNotifier {
  notify(alert: CapacityAlert): Promise<void>;
}

export interface WorkerCapacityAlertJobOptions {
  lease: IJobLease;
  heartbeats: IWorkerHeartbeatRepository;
  adoption: ISessionAdoptionRepository;
  notifier?: ICapacityAlertNotifier;
  intervalMs?: number;
  now?: () => Date;
}

/**
 * Alerta de capacidade (ADOPT-11): tick de 60 s sob o lease `worker-capacity-alert` (1 processo por
 * vez). Soma sessões/tetos dos workers vivos e pedidos sem dono há > 2 min; `capacityAlertReason`
 * decide. Sem alerta, nada é escrito além do lease.
 */
export class WorkerCapacityAlertJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly ownerId = randomUUID();
  private readonly log = logger.child({ module: 'WorkerCapacityAlertJob' });

  constructor(private readonly options: WorkerCapacityAlertJobOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runTick(), this.options.intervalMs ?? ALERT_TICK_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  /** Exposto para teste; nunca lança. */
  runTick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.tickOnce()
      .catch((err) => this.log.warn({ err: (err as Error)?.name }, 'worker capacity alert tick failed'))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async tickOnce(): Promise<void> {
    const { lease, heartbeats, adoption } = this.options;
    const now = this.options.now?.() ?? new Date();
    const acquired = await lease.tryAcquire(
      CAPACITY_ALERT_LEASE, this.ownerId, new Date(now.getTime() + ALERT_LEASE_TTL_MS), now,
    );
    if (!acquired) return;

    const [alive, awaiting] = await Promise.all([
      heartbeats.listAlive(WORKER_ALIVE_MS),
      adoption.countAwaitingCapacity(AWAITING_ALERT_MS),
    ]);
    const sessions = alive.reduce((sum, w) => sum + w.sessions, 0);
    const maxSessions = alive.reduce((sum, w) => sum + w.maxSessions, 0);
    // A contagem já filtra pedidos mais velhos que o limite: qualquer um passa dele
    const reason = capacityAlertReason({
      sessions,
      maxSessions,
      awaitingOverMs: awaiting > 0 ? AWAITING_ALERT_MS + 1 : null,
    });
    if (!reason) return;

    const alert: CapacityAlert = { reason, workers: alive.length, sessions, maxSessions, awaiting };
    this.log.warn(alert, 'worker capacity alert');
    await this.maybeNotify(alert, now);
  }

  private async maybeNotify(alert: CapacityAlert, now: Date): Promise<void> {
    const { notifier, lease } = this.options;
    if (!notifier) return;
    const until = new Date(now.getTime() + EMAIL_COOLDOWN_MS);
    if (!(await lease.tryAcquire(CAPACITY_ALERT_EMAIL_LEASE, this.ownerId, until, now))) return;
    try {
      await notifier.notify(alert);
    } catch (err) {
      this.log.warn({ err: (err as Error)?.name }, 'worker capacity alert e-mail failed');
    }
  }
}
