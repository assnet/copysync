import { InfraCostMonthUnavailableError } from '../../../../shared/errors/internal/InfraCostErrors';
import type { IWorkerCapacityReader } from '../../../sessions/domain/contracts/IWorkerCapacityReader';
import type { IWorkerScalingSettingsProvider } from '../../../sessions/domain/contracts/IWorkerScalingSettingsProvider';
import type { IInfraCostLiveReader } from '../../domain/contracts/IInfraCostLiveReader';
import type { IInfraCostSettingsRepository } from '../../domain/contracts/IInfraCostSettingsRepository';
import type { IInfraCostSnapshotRepository } from '../../domain/contracts/IInfraCostSnapshotRepository';
import type { IInfraFxFetchStateRepository } from '../../domain/contracts/IInfraFxFetchStateRepository';
import { resolveFxRate, type SavedFxRate } from '../../domain/services/fxRate';
import { fxFetchFailedToday, utcDayOf } from '../../domain/services/infraFxFetchState';
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
  /** Última cotação gravada pelo job (P2); ausente = só override. */
  fxRates?: Pick<IInfraCostSnapshotRepository, 'latestFxRate'>;
  /** Estado da busca do dia: falhou hoje → a gravada vira `last_known`. */
  fxFetchState?: IInfraFxFetchStateRepository;
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

    const [record, live, capacityByPlan, saved, fetchState] = await Promise.all([
      this.deps.settings.get(),
      this.deps.live.read(now),
      this.deps.capacity.readByPlan(),
      this.deps.fxRates?.latestFxRate(new Date(`${utcDayOf(now)}T00:00:00Z`)) ?? null,
      this.deps.fxFetchState?.get() ?? null,
    ]);
    const settings = resolveInfraCostSettings(record).value;
    const { maxSessionsPerWorker, alertOccupancyRatio } = this.deps.scaling.current().value;

    const calculation = calculateInfraCosts({
      settings,
      fx: resolveFxRate({
        fx: settings.fx,
        today: now,
        saved: saved ? toSavedFxRate(saved) : null,
        fetchFailedToday: fxFetchFailedToday(fetchState, now),
      }),
      live: { sessionsConnected: live.sessionsConnected, workerInstances: live.workerInstances, sessionsSampledAt: live.sessionsSampledAt },
      now,
      capacityByPlan,
      scaling: { maxSessionsPerWorker, alertOccupancyRatio },
    });
    return { month, generatedAt: now, calculation };
  }
}

function toSavedFxRate(r: { referenceDate: Date; rate: number; source: 'ptax' | 'sgs'; fetchedAt: Date }): SavedFxRate {
  return { rate: r.rate, referenceDate: utcDayOf(r.referenceDate), source: r.source, fetchedAt: r.fetchedAt };
}
