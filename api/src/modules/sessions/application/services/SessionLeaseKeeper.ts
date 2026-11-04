import { LEASE_RENEW_INTERVAL_MS } from '../../domain/services/sessionLeasePolicy';
import type { LeaseLogger } from '../use-cases/AcquireSessionLeaseUseCase';
import { logger } from '../../../../shared/logger/logger';

export interface LeaseRenewer {
  execute(): Promise<void>;
}

/**
 * Keeper do lease (LEASE-04): `setTimeout` encadeado — o próximo tick só é agendado depois
 * que o atual termina, então rodadas nunca se sobrepõem. `stop` cancela o agendado e espera
 * o tick em curso (shutdown, LEASE-09).
 */
export class SessionLeaseKeeper {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private active = false;

  constructor(
    private readonly renewer: LeaseRenewer,
    private readonly intervalMs: number = LEASE_RENEW_INTERVAL_MS,
    private readonly log: LeaseLogger = logger.child({ module: 'SessionLeaseKeeper' }),
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    // Tick em curso (stop sem await + start): o `finally` dele agenda o próximo.
    if (!this.running) this.schedule();
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }

  private schedule(): void {
    if (!this.active) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.running = this.tick().finally(() => {
        this.running = undefined;
        this.schedule();
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      await this.renewer.execute();
    } catch (err) {
      this.log.warn({ err }, 'falha na rodada de renovação de lease');
    }
  }
}
