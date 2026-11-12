import { InfraCostMonthUnavailableError } from '../../../../shared/errors/internal/InfraCostErrors';
import type { IWorkerCapacityReader } from '../../../sessions/domain/contracts/IWorkerCapacityReader';
import type { IWorkerScalingSettingsProvider } from '../../../sessions/domain/contracts/IWorkerScalingSettingsProvider';
import type { IInfraCostLiveReader } from '../../domain/contracts/IInfraCostLiveReader';
import type { IInfraCostSettingsRepository } from '../../domain/contracts/IInfraCostSettingsRepository';
import type { IInfraCostSnapshotRepository } from '../../domain/contracts/IInfraCostSnapshotRepository';
import type { IInfraFxFetchStateRepository } from '../../domain/contracts/IInfraFxFetchStateRepository';
import type { IInfraCostUsageReader, InfraCostMonthUsage } from '../../domain/contracts/IInfraCostUsageReader';
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
  /** Agregados do mês dos snapshots (P2); ausente = só a foto do mês corrente. */
  usage?: IInfraCostUsageReader;
  now?: () => Date;
}

/** `YYYY-MM` do instante em UTC. */
export function utcMonthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Início (00:00 UTC do dia 1) do mês `YYYY-MM` e do seguinte. */
export function utcMonthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

const hasData = (u: InfraCostMonthUsage) => u.resourceHours.length > 0 || u.tenants.length > 0;

/**
 * Resumo de custos do mês (COST-04/05/06a/11/12). Mês corrente: soma das horas (`basis: 'hours'`) quando há
 * snapshot no mês, senão a foto do momento × mês inteiro (`basis: 'snapshot'`). Mês passado: só horas; sem
 * dado (ou mês futuro) → 400 `INFRA_COST_MONTH_UNAVAILABLE`. No mês passado não entram a foto de agora
 * (sessões do cluster, capacidade por plano) nem a busca de cotação de hoje: cotação = última gravada até o
 * fim do mês (o override vale sempre). Lê só tabelas locais: nunca chama a Render.
 */
export class GetInfraCostSummaryUseCase {
  private readonly now: () => Date;

  constructor(private readonly deps: GetInfraCostSummaryDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async execute(input: GetInfraCostSummaryInput = {}): Promise<InfraCostSummaryOutput> {
    const now = this.now();
    const current = utcMonthOf(now);
    const month = input.month ?? current;
    if (month > current || (month < current && !this.deps.usage)) throw new InfraCostMonthUnavailableError(month);
    return month === current ? this.currentMonth(month, now) : this.pastMonth(month, now);
  }

  private async currentMonth(month: string, now: Date): Promise<InfraCostSummaryOutput> {
    const { start, end } = utcMonthRange(month);
    const [record, live, capacityByPlan, saved, fetchState, usage] = await Promise.all([
      this.deps.settings.get(),
      this.deps.live.read(now),
      this.deps.capacity.readByPlan(),
      this.deps.fxRates?.latestFxRate(new Date(`${utcDayOf(now)}T00:00:00Z`)) ?? null,
      this.deps.fxFetchState?.get() ?? null,
      this.deps.usage?.readMonth(start, end) ?? null,
    ]);
    const hourly = usage && hasData(usage) ? { monthStart: start, monthEnd: end, ...usage } : undefined;
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
      hourly,
    });
    return { month, generatedAt: now, calculation };
  }

  private async pastMonth(month: string, now: Date): Promise<InfraCostSummaryOutput> {
    const { start, end } = utcMonthRange(month);
    // Último dia do mês: cotação e "desatualizada" medidas contra ele, não contra hoje.
    const lastDay = new Date(end.getTime() - 86_400_000);
    const [record, saved, usage] = await Promise.all([
      this.deps.settings.get(),
      this.deps.fxRates?.latestFxRate(lastDay) ?? null,
      this.deps.usage!.readMonth(start, end),
    ]);
    if (!hasData(usage)) throw new InfraCostMonthUnavailableError(month);
    const settings = resolveInfraCostSettings(record).value;
    const { maxSessionsPerWorker, alertOccupancyRatio } = this.deps.scaling.current().value;
    const calculation = calculateInfraCosts({
      settings,
      fx: resolveFxRate({ fx: settings.fx, today: lastDay, saved: saved ? toSavedFxRate(saved) : null, fetchFailedToday: false }),
      live: { sessionsConnected: null, workerInstances: null, sessionsSampledAt: null },
      now,
      capacityByPlan: [],
      scaling: { maxSessionsPerWorker, alertOccupancyRatio },
      hourly: { monthStart: start, monthEnd: end, ...usage },
    });
    return { month, generatedAt: now, calculation };
  }
}

function toSavedFxRate(r: { referenceDate: Date; rate: number; source: 'ptax' | 'sgs'; fetchedAt: Date }): SavedFxRate {
  return { rate: r.rate, referenceDate: utcDayOf(r.referenceDate), source: r.source, fetchedAt: r.fetchedAt };
}
