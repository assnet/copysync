import { UsageMetricsReadUnavailableError } from '../../../../shared/errors/internal/UsageMetricsErrors';
import type { FeatureUsageReadInput, FeatureUsageReadResult, IFeatureUsageReader } from '../../domain/contracts/IFeatureUsageReader';
import type { IUsageReadGate, UsageReadBudget } from '../../domain/contracts/IUsageReadGate';
import type { IUsageTenantDirectory, UsageTenantDirectoryEntry } from '../../domain/contracts/IUsageTenantDirectory';
import type { FeatureUsageRow } from '../../domain/services/aggregateFeatureUsage';

/**
 * Dublês dos testes dos use cases do uso dos recursos (só testes importam). Relógio falso compartilhado: o
 * orçamento conta desde a criação (como o real) e cada dublê pode "gastar" tempo avançando o relógio.
 */
export class FakeClock {
  constructor(public ms = 0) {}
  advance(ms: number): void {
    this.ms += ms;
  }
}

export class FakeUsageReadGate implements IUsageReadGate {
  busy = false;
  opened = 0;
  budgets: UsageReadBudget[] = [];

  constructor(
    private readonly clock = new FakeClock(),
    private readonly totalMs = 2000,
  ) {}

  /** Fila FIFO como a real (sem teto nem prazo de espera): cada pedido espera o anterior terminar. */
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(read: (budget: UsageReadBudget) => Promise<T>): Promise<T> {
    const deadline = this.clock.ms + this.totalMs;
    const previous = this.tail;
    let done!: () => void;
    this.tail = new Promise<void>((r) => (done = r));
    await previous;
    this.busy = true;
    this.opened += 1;
    const budget: UsageReadBudget = {
      remainingMs: () => deadline - this.clock.ms,
      track: () => undefined,
      settled: async () => undefined,
    };
    this.budgets.push(budget);
    try {
      return await read(budget);
    } finally {
      this.busy = false;
      done();
    }
  }
}

export class FakeFeatureUsageReader implements IFeatureUsageReader {
  calls: FeatureUsageReadInput[] = [];
  /** Tempo gasto por leitura (avança o relógio). */
  spendMs = 0;
  /** Segura a leitura até `release()` (pedido simultâneo). */
  hold: Promise<void> | null = null;
  fail: Error | null = null;

  constructor(
    public rows: FeatureUsageRow[] = [],
    public firstDataDay: FeatureUsageReadResult['firstDataDay'] = {},
    private readonly clock = new FakeClock(),
  ) {}

  async read(input: FeatureUsageReadInput): Promise<FeatureUsageReadResult> {
    this.calls.push(input);
    if (this.hold) await this.hold;
    this.clock.advance(this.spendMs);
    if (this.fail) throw this.fail;
    return { rows: this.rows, firstDataDay: this.firstDataDay };
  }
}

export class FakeUsageTenantDirectory implements IUsageTenantDirectory {
  listBudgets: number[] = [];
  namesCalls: string[][] = [];
  namesBudgets: number[] = [];

  constructor(
    public tenants: UsageTenantDirectoryEntry[] = [],
    public tenantNames: Map<string, string> = new Map(),
  ) {}

  async list(budget: UsageReadBudget): Promise<UsageTenantDirectoryEntry[]> {
    this.listBudgets.push(budget.remainingMs());
    return this.tenants;
  }

  async names(ids: readonly string[], budget: UsageReadBudget): Promise<Map<string, string>> {
    this.namesCalls.push([...ids]);
    this.namesBudgets.push(budget.remainingMs());
    return new Map(ids.filter((id) => this.tenantNames.has(id)).map((id) => [id, this.tenantNames.get(id)!]));
  }
}

export const usageTenant = (
  tenantId: string,
  affiliatesPlan: string,
  saverPlan = 'NONE',
  extra: Partial<UsageTenantDirectoryEntry> = {},
): UsageTenantDirectoryEntry => ({
  tenantId,
  affiliatesPlan,
  saverPlan,
  status: 'ACTIVE',
  internal: false,
  createdAt: new Date('2026-01-01T12:00:00.000Z'),
  ...extra,
});

export const usageRow = (day: string, tenantId: string, featureKey: string, kind: FeatureUsageRow['kind'], uses = 1): FeatureUsageRow => ({
  day,
  tenantId,
  featureKey,
  kind,
  uses,
  activeDays: 1,
  lastDay: day,
});
