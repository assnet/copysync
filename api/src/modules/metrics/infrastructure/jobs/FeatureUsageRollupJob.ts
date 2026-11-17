import { logger } from '../../../../shared/logger/logger';
import type { RollupFeatureUsageUseCase } from '../../application/use-cases/RollupFeatureUsageUseCase';

/** Tick do job; os leases do use case (10 min) vencem antes do tick seguinte. */
export const FEATURE_USAGE_ROLLUP_TICK_MS = 15 * 60_000;
/** Orçamento de cada leitura de fonte no job (fora do portão do `http`); 11 fontes × 2 passos cabem no lease. */
export const FEATURE_USAGE_ROLLUP_READ_BUDGET_MS = 20_000;

export interface FeatureUsageRollupJobOptions {
  rollup: Pick<RollupFeatureUsageUseCase, 'execute'>;
  intervalMs?: number;
}

/**
 * Consolidação do uso dos recursos (design §4.4), só no `worker`/`all` e com `FEATURE_USAGE_ROLLUP_ENABLED`.
 * `start()` só arma o timer (`unref`): nada roda no boot. Cada tick chama o use case, que faz tudo sob lease
 * (`feature-usage-rollup`, TTL 10 min < tick, solto ao terminar). Tick ainda em curso não é reentrado. Nunca lança.
 */
export class FeatureUsageRollupJob {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;
  private readonly log = logger.child({ module: 'FeatureUsageRollupJob' });

  constructor(private readonly options: FeatureUsageRollupJobOptions) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.runTick(), this.options.intervalMs ?? FEATURE_USAGE_ROLLUP_TICK_MS);
    this.timer.unref();
  }

  /** Para o timer e espera o tick em curso (o use case solta os leases dele). Nunca lança. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  /** Exposto para teste; nunca lança. */
  runTick(): Promise<void> {
    if (this.running) return this.running;
    if (this.stopped) return Promise.resolve();
    this.running = this.options.rollup
      .execute()
      .then((r) => {
        if (r.status === 'ran' && r.failedGroups > 0) this.log.warn({ failedGroups: r.failedGroups }, 'feature usage rollup partial');
      })
      .catch((err) => this.log.warn({ err: (err as Error)?.name }, 'feature usage rollup tick failed'))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
}
