import { InfraCostMonthUnavailableError } from '../../../../shared/errors/internal/InfraCostErrors';
import type { IWorkerCapacityReader } from '../../../sessions/domain/contracts/IWorkerCapacityReader';
import type { IWorkerScalingSettingsProvider } from '../../../sessions/domain/contracts/IWorkerScalingSettingsProvider';
import type { IInfraCostLiveReader } from '../../domain/contracts/IInfraCostLiveReader';
import type { IInfraCostMonthRepository, InfraCostClosedMonthSummary } from '../../domain/contracts/IInfraCostMonthRepository';
import type { IInfraCostSettingsRepository } from '../../domain/contracts/IInfraCostSettingsRepository';
import type { IInfraCostSnapshotRepository } from '../../domain/contracts/IInfraCostSnapshotRepository';
import type { IInfraFxFetchStateRepository } from '../../domain/contracts/IInfraFxFetchStateRepository';
import type { IInfraCostUsageReader, InfraCostMonthUsage } from '../../domain/contracts/IInfraCostUsageReader';
import { resolveFxRate, type SavedFxRate } from '../../domain/services/fxRate';
import { fxFetchFailedToday, utcDayOf } from '../../domain/services/infraFxFetchState';
import { calculateInfraCosts, type InfraCostCalculation } from '../../domain/services/infraCostCalculator';
import { resolveInfraCostSettings, type InfraCostSettings } from '../../domain/services/infraCostSettings';
import type { InfraCostMonthClosingWarning } from './CloseInfraCostMonthUseCase';

export interface GetInfraCostSummaryInput {
  /** `YYYY-MM`; ausente = mês corrente (UTC). */
  month?: string;
}

export interface InfraCostSummaryOutput {
  /** `YYYY-MM`. */
  month: string;
  /** Hora da conta; no mês fechado, a do fechamento. */
  generatedAt: Date;
  /** Mês fechado: avisos do fechamento inclusos (`fx_fallback`, `usage_incomplete`). */
  calculation: Omit<InfraCostCalculation, 'warnings'> & { warnings: InfraCostMonthClosingWarning[] };
  /** Configuração usada na conta (a lista por cliente precifica a IA da página com os mesmos preços). */
  settings: InfraCostSettings;
  /** `true` = conta e cotação congeladas no fechamento (`infra_cost_months`); preço editado depois não muda. */
  closed: boolean;
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
  /** Meses fechados (COST-15): mês passado fechado devolve a conta congelada; ausente = sempre recalcula. */
  months?: Pick<IInfraCostMonthRepository, 'findClosedMonth'>;
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
 * Resumo de custos do mês (COST-04/05/06a/11/12/15). Mês passado já fechado: a conta e a cotação congeladas
 * em `infra_cost_months` (`closed: true`), igual ao histórico e à lista por cliente. Mês corrente: soma das horas (`basis: 'hours'`) quando há
 * snapshot no mês, senão a foto do momento × mês inteiro (`basis: 'snapshot'`). Mês passado: só horas; sem
 * dado (ou mês futuro) → 400 `INFRA_COST_MONTH_UNAVAILABLE`. No mês passado ainda não fechado não entram a foto de agora
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
    return { month, generatedAt: now, calculation, settings, closed: false };
  }

  private async pastMonth(month: string, now: Date): Promise<InfraCostSummaryOutput> {
    const { start, end } = utcMonthRange(month);
    const closed = await this.deps.months?.findClosedMonth(start);
    const frozen = closed ? readFrozenSummary(month, closed) : null;
    if (frozen) return frozen;
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
    return { month, generatedAt: now, calculation, settings, closed: false };
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const toDate = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Conta congelada do fechamento (`totals` versão 1): datas do JSON viram `Date` e a cotação é a da linha do mês.
 * Ilegível → `null` (o mês volta a ser recalculado com `closed: false`, nunca 500).
 */
function readFrozenSummary(month: string, closed: InfraCostClosedMonthSummary): InfraCostSummaryOutput | null {
  const { totals } = closed;
  const calc = totals.calculation;
  if (totals.version !== 1 || !isObj(calc) || !isObj(totals.settings)) return null;
  const shapeOk = (calc.basis === 'hours' || calc.basis === 'snapshot') && isObj(calc.totals) && isObj(calc.workspace)
    && isObj(calc.perSession) && Array.isArray(calc.items) && Array.isArray(calc.plans) && Array.isArray(calc.warnings);
  if (!shapeOk) return null;
  const savedFx = isObj(calc.fx) ? calc.fx : null;
  const fx = closed.fx
    ? {
        rate: closed.fx.rate,
        referenceDate: closed.fx.referenceDate.toISOString().slice(0, 10),
        source: closed.fx.source,
        fetchedAt: toDate(savedFx?.fetchedAt),
        stale: savedFx?.stale === true,
      }
    : null;
  const frozen = calc as unknown as InfraCostSummaryOutput['calculation'];
  return {
    month,
    generatedAt: closed.closedAt,
    calculation: { ...frozen, fx, sessionsSampledAt: toDate(calc.sessionsSampledAt) },
    settings: totals.settings as unknown as InfraCostSettings,
    closed: true,
  };
}

function toSavedFxRate(r: { referenceDate: Date; rate: number; source: 'ptax' | 'sgs'; fetchedAt: Date }): SavedFxRate {
  return { rate: r.rate, referenceDate: utcDayOf(r.referenceDate), source: r.source, fetchedAt: r.fetchedAt };
}
