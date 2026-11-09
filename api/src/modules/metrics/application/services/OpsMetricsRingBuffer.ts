import type { OpsMetricTick } from '../../domain/services/aggregateOpsMetrics';

/** 60 ticks de 60 s = 60 min (MQ-23). */
export const OPS_RING_CAPACITY = 60;

/**
 * Últimos ticks do sampler, em memória. Exceção declarada à regra de escala (MQ-23,
 * docs/arquitetura-escala.md): é só cache de `ops_metrics_samples`; perda ≤ 5 min em crash aceita.
 */
export class OpsMetricsRingBuffer {
  private readonly items: OpsMetricTick[] = [];

  constructor(private readonly capacity: number = OPS_RING_CAPACITY) {}

  push(tick: OpsMetricTick): void {
    this.items.push(tick);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }

  /** Ticks com `at >= since`, mais antigo → mais novo. */
  since(since: Date): OpsMetricTick[] {
    return this.items.filter((t) => t.at.getTime() >= since.getTime());
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}
