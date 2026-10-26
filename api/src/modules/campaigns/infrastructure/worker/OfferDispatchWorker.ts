import { logger } from '../../../../shared/logger/logger';

export interface OfferDispatchTick {
  execute(): Promise<{ processed: number }>;
}

export interface OfferDispatchWorkerOptions {
  tick: () => OfferDispatchTick;
  intervalMs?: number;
  stopTimeoutMs?: number;
}

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_STOP_TIMEOUT_MS = 10_000;

/**
 * Processa envios de oferta vencidos a cada 2 s. Um tick por vez (o seguinte é pulado se o
 * anterior ainda roda); multi-instância seguro pelo claim `SKIP LOCKED` do repositório.
 * Equivalente futuro: fila `broadcast.post` (docs/arquitetura-escala.md §3.6).
 */
export class OfferDispatchWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private readonly log = logger.child({ module: 'OfferDispatchWorker' });

  constructor(private readonly options: OfferDispatchWorkerOptions) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runTick(), this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  /** Para o intervalo e espera o tick em curso terminar (no máximo `stopTimeoutMs`). */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.running) return;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
    });
    try {
      // Tick preso não segura o shutdown; envio em curso volta à fila pelo releaseStale
      if (await Promise.race([this.running.then(() => false), timedOut])) {
        this.log.warn('offer dispatch tick still running at stop; giving up waiting');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Exposto para teste; nunca lança. `finally` roda em microtask, depois da atribuição. */
  runTick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.tickOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async tickOnce(): Promise<void> {
    try {
      const { processed } = await this.options.tick().execute();
      if (processed > 0) this.log.debug({ processed }, 'offer dispatches processed');
    } catch (err) {
      this.log.error({ err }, 'offer dispatch tick failed');
    }
  }
}
