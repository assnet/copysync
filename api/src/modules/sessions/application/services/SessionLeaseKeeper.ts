import { LEASE_RENEW_INTERVAL_MS } from '../../domain/services/sessionLeasePolicy';
import type { LeaseLogger } from '../use-cases/AcquireSessionLeaseUseCase';
import { logger } from '../../../../shared/logger/logger';

export interface LeaseRenewer {
  /** Rodada de renovação; devolve as sessões suspensas a reabrir. */
  execute(): Promise<readonly string[] | void>;
  /** Reabre uma suspensa (chamado fora do tick). */
  resume?(sessionId: string): Promise<void>;
}

/**
 * Keeper do lease (LEASE-04): `setTimeout` encadeado — o próximo tick só é agendado depois
 * que o atual termina, então rodadas nunca se sobrepõem. As retomadas que a rodada devolve
 * saem sem `await` (fila própria, uma por sessão por vez): retomada lenta não atrasa a
 * renovação das outras. A retomada assenta no prazo do use case mesmo com banco mudo (F12), então o
 * slot de `resuming` nunca fica preso. `stop` cancela o agendado e espera o tick em curso e as
 * retomadas (estas no máximo `intervalMs`) (shutdown, LEASE-09).
 */
export class SessionLeaseKeeper {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private active = false;
  private readonly resuming = new Map<string, Promise<void>>();

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
    await this.settleResumes();
  }

  private async settleResumes(): Promise<void> {
    if (this.resuming.size === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.intervalMs);
    });
    try {
      await Promise.race([Promise.allSettled([...this.resuming.values()]), limit]);
    } finally {
      clearTimeout(timer);
    }
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
      this.dispatchResumes((await this.renewer.execute()) ?? []);
    } catch (err) {
      this.log.warn({ err }, 'falha na rodada de renovação de lease');
    }
  }

  /** Dispara sem `await`; sessão com retomada em curso fica para a próxima rodada. */
  private dispatchResumes(ids: readonly string[]): void {
    const resume = this.renewer.resume?.bind(this.renewer);
    if (!resume || !this.active) return;
    for (const id of ids) {
      if (this.resuming.has(id)) continue;
      const run = resume(id)
        .catch((err: unknown) => this.log.warn({ err, sessionId: id }, 'falha ao retomar sessão suspensa'))
        .finally(() => {
          if (this.resuming.get(id) === run) this.resuming.delete(id);
        });
      this.resuming.set(id, run);
    }
  }
}
