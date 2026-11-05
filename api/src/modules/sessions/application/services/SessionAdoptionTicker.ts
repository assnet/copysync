import { ADOPT_TICK_MS } from '../../domain/services/sessionAdoptionPolicy';
import { logger } from '../../../../shared/logger/logger';

export interface AdoptionTick {
  execute(): Promise<unknown>;
  /** Solta o tick em curso sem esperar trabalho longo (abertura de socket). */
  cancel?(): void;
}

export type AdoptionTickerLogger = Pick<typeof logger, 'warn'>;

/**
 * Ticker da adoção (ADOPT-07): `setTimeout` encadeado com `unref` — o próximo tick só agenda
 * depois que o atual termina (uma adoção por tick, D2). `stop` cancela o agendado, cancela o
 * tick em curso (`cancel`: a abertura da adoção não segura o shutdown) e espera ele assentar
 * (ADOPT-14). Erro do tick só loga.
 */
export class SessionAdoptionTicker {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private active = false;

  constructor(
    private readonly tick: AdoptionTick,
    private readonly intervalMs: number = ADOPT_TICK_MS,
    private readonly log: AdoptionTickerLogger = logger.child({ module: 'SessionAdoptionTicker' }),
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    if (!this.running) this.schedule();
  }

  async stop(): Promise<void> {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.running) this.tick.cancel?.();
    await this.running;
  }

  private schedule(): void {
    if (!this.active) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.running = this.run().finally(() => {
        this.running = undefined;
        this.schedule();
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  private async run(): Promise<void> {
    try {
      await this.tick.execute();
    } catch (err) {
      this.log.warn({ err }, 'falha no tick de adoção de sessões');
    }
  }
}
