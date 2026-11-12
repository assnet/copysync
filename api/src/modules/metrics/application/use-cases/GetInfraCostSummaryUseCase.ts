import { InfraCostMonthUnavailableError } from '../../../../shared/errors/internal/InfraCostErrors';
import type { IWorkerCapacityReader } from '../../../sessions/domain/contracts/IWorkerCapacityReader';
import type { IWorkerScalingSettingsProvider } from '../../../sessions/domain/contracts/IWorkerScalingSettingsProvider';
import type { IInfraCostLiveReader } from '../../domain/contracts/IInfraCostLiveReader';
import type { IInfraCostSettingsRepository } from '../../domain/contracts/IInfraCostSettingsRepository';
import { resolveFxRate } from '../../domain/services/fxRate';
import { calculateInfraCosts, type InfraCostCalculation } from '../../domain/services/infraCostCalculator';
import { resolveInfraCostSettings } from '../../domain/services/infraCostSettings';

export interface GetInfraCostSummaryInput {
  /** `YYYY-MM`; ausente = mês corrente (UTC). */
  month?: string;
}

export interface InfraCostSummaryOutput {
  /** `YYYY-MM`. */
  month: string;
  generatedAt: Date;
  calculation: InfraCostCalculation;
}

export interface GetInfraCostSummaryDeps {
  settings: IInfraCostSettingsRepository;
  live: IInfraCostLiveReader;
  /** Porta do `sessions` (agregado por plano, só tenants `ACTIVE`). */
  capacity: IWorkerCapacityReader;
  /** Lido a cada chamada (`.current().value`), nunca guardado. */
  scaling: IWorkerScalingSettingsProvider;
  now?: () => Date;
}

/** `YYYY-MM` do instante em UTC. */
export function utcMonthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Resumo de custos do mês (COST-04/05/06a). P1: só o mês corrente, foto do momento × mês inteiro
 * (`basis: 'snapshot'`); outro mês → 400 `INFRA_COST_MONTH_UNAVAILABLE`. Lê só tabelas locais:
 * nunca chama a Render.
 */
export class GetInfraCostSummaryUseCase {
  private readonly now: () => Date;

  constructor(private readonly deps: GetInfraCostSummaryDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async execute(input: GetInfraCostSummaryInput = {}): Promise<InfraCostSummaryOutput> {
    const now = this.now();
    const month = utcMonthOf(now);
    if (input.month !== undefined && input.month !== month) throw new InfraCostMonthUnavailableError(input.month);

    const [record, live, capacityByPlan] = await Promise.all([
      this.deps.settings.get(),
      this.deps.live.read(now),
      this.deps.capacity.readByPlan(),
    ]);
    const settings = resolveInfraCostSettings(record).value;
    const { maxSessionsPerWorker, alertOccupancyRatio } = this.deps.scaling.current().value;

    const calculation = calculateInfraCosts({
      settings,
      fx: resolveFxRate({ fx: settings.fx, today: now }),
      live: { sessionsConnected: live.sessionsConnected, workerInstances: live.workerInstances, sessionsSampledAt: live.sessionsSampledAt },
      now,
      capacityByPlan,
      scaling: { maxSessionsPerWorker, alertOccupancyRatio },
    });
    return { month, generatedAt: now, calculation };
  }
}
