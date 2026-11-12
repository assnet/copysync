import type { IInfraCostReportReader } from '../../domain/contracts/IInfraCostReportReader';
import type { InfraMoney } from '../../domain/services/infraCostCalculator';
import type { InfraFxClosingMethod } from '../../domain/services/infraCostSettings';
import { utcMonthOf, utcMonthRange } from './GetInfraCostSummaryUseCase';

/** Meses do histórico: os 12 anteriores ao corrente (o corrente fica no resumo). */
export const INFRA_COST_HISTORY_MONTHS = 12;

export interface InfraCostHistoryPlan {
  planSlug: string | null;
  tenants: number;
  shared: InfraMoney;
  ai: InfraMoney;
  total: InfraMoney;
}

export interface InfraCostHistoryMonth {
  /** `YYYY-MM`. */
  month: string;
  closedAt: Date;
  closingMethod: InfraFxClosingMethod;
  fx: { rate: number; referenceDate: string; source: 'override' | 'ptax' | 'sgs' } | null;
  total: InfraMoney;
  totalIsPartial: boolean;
  /** Compartilhado sem base de rateio (fora dos tenants). */
  unallocated: InfraMoney;
  /** Itens fora do rateio (`excluded` e IA fixa): no total, fora dos tenants. Σ planos + os dois = total. */
  excluded: InfraMoney;
  plans: InfraCostHistoryPlan[];
}

export interface InfraCostHistoryOutput {
  /** Primeiro e último mês da janela (`YYYY-MM`), para o painel mostrar os meses sem fechamento. */
  from: string;
  to: string;
  /** Só meses fechados, por mês crescente. */
  months: InfraCostHistoryMonth[];
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const money = (usd: number, rate: number | null): InfraMoney => ({ usd: round4(usd), brl: rate === null ? null : round4(usd * rate) });

/**
 * Histórico mensal (COST-15), super admin: meses fechados (`infra_cost_months`) dos 12 anteriores ao corrente,
 * total e por plano (soma de `infra_cost_month_tenants`), em USD e BRL pela cotação congelada do mês.
 */
export class GetInfraCostHistoryUseCase {
  private readonly now: () => Date;

  constructor(private readonly reports: Pick<IInfraCostReportReader, 'listClosedMonths'>, now?: () => Date) {
    this.now = now ?? (() => new Date());
  }

  async execute(): Promise<InfraCostHistoryOutput> {
    const { start: currentStart } = utcMonthRange(utcMonthOf(this.now()));
    const from = new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() - INFRA_COST_HISTORY_MONTHS, 1));
    const to = new Date(Date.UTC(currentStart.getUTCFullYear(), currentStart.getUTCMonth() - 1, 1));
    const rows = await this.reports.listClosedMonths(from, currentStart);
    return {
      from: utcMonthOf(from),
      to: utcMonthOf(to),
      months: rows.map((m) => {
        const rate = m.fx?.rate ?? null;
        return {
          month: utcMonthOf(m.month),
          closedAt: m.closedAt,
          closingMethod: m.closingMethod,
          fx: m.fx ? { rate: m.fx.rate, referenceDate: m.fx.referenceDate.toISOString().slice(0, 10), source: m.fx.source } : null,
          total: money(m.totalUsd, rate),
          totalIsPartial: m.totalIsPartial,
          unallocated: money(m.unallocatedUsd, rate),
          excluded: money(m.excludedUsd, rate),
          plans: m.plans.map((p) => ({
            planSlug: p.planSlug,
            tenants: p.tenants,
            shared: money(p.sharedUsd, rate),
            ai: money(p.aiUsd, rate),
            total: money(p.totalUsd, rate),
          })),
        };
      }),
    };
  }
}
