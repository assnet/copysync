import { createCursor, readCursor } from '../../../../shared/http/pagination/OpaqueCursor';
import type { IInfraCostMonthRepository } from '../../domain/contracts/IInfraCostMonthRepository';
import type { IInfraCostReportReader } from '../../domain/contracts/IInfraCostReportReader';
import { calculateInfraAiCosts, type InfraMoney } from '../../domain/services/infraCostCalculator';
import { utcMonthOf, utcMonthRange, type GetInfraCostSummaryInput, type InfraCostSummaryOutput } from './GetInfraCostSummaryUseCase';

/** Tamanho da página: decisão do servidor (o painel só devolve o cursor). */
export const INFRA_COST_TENANTS_PAGE_SIZE = 50;

export interface ListInfraCostTenantsInput {
  /** `YYYY-MM`; ausente = mês corrente (UTC). */
  month?: string;
  /** Slug do plano; ausente = todos. */
  planSlug?: string;
  cursor?: string;
}

/** Cotação usada na página: a da conta (mês aberto) ou a congelada no fechamento. */
export interface InfraCostTenantsFx {
  rate: number;
  /** `YYYY-MM-DD`. */
  referenceDate: string;
  source: 'override' | 'ptax' | 'sgs' | 'last_known';
}

/** Um tenant da lista: só id e nome do tenant; valores em USD e BRL (4 casas). */
export interface InfraCostTenantRow {
  tenantId: string;
  tenantName: string;
  planSlug: string | null;
  /** Contratadas médias do mês (base padrão do rateio). */
  contractedSessions: number;
  sessionHours: number;
  /** Compartilhado pela base contratadas; `null` = sem divisor. */
  shared: InfraMoney | null;
  /** Compartilhado pela sessão-hora; `null` no mês fechado (não congelado) ou sem divisor. */
  connectedShared: InfraMoney | null;
  /** Mês corrente: compartilhado projetado para o mês cheio (margem); `null` fora dele. */
  projectedShared: InfraMoney | null;
  /** IA da plataforma do tenant (só modelos com preço). */
  ai: InfraMoney;
  /** shared + ai; `null` quando shared é `null`. */
  total: InfraMoney | null;
}

export interface ListInfraCostTenantsOutput {
  month: string;
  /** `closed` = valores congelados em `infra_cost_month_tenants`. */
  status: 'open' | 'closed';
  /** `snapshot` = mês corrente sem snapshot (lista vazia). */
  basis: 'snapshot' | 'hours';
  fx: InfraCostTenantsFx | null;
  tenants: InfraCostTenantRow[];
  nextCursor: string | null;
}

export interface ListInfraCostTenantsDeps {
  /** Conta do mês aberto (mesma do resumo, com timeout → 503). */
  summary: { execute(input: GetInfraCostSummaryInput): Promise<InfraCostSummaryOutput> };
  months: Pick<IInfraCostMonthRepository, 'findClosedMonth'>;
  reports: IInfraCostReportReader;
  now?: () => Date;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const money = (usd: number, rate: number | null): InfraMoney => ({ usd: round4(usd), brl: rate === null ? null : round4(usd * rate) });
const maybeMoney = (usd: number | null, rate: number | null) => (usd === null ? null : money(usd, rate));
const times = (a: number, b: number | null) => (b === null ? null : a * b);

/**
 * Lista por cliente (COST-14), super admin. Mês fechado: valores congelados, ordem `totalUsd desc, tenantId`.
 * Mês aberto (corrente ou passado ainda não fechado): conta do mês (`GetInfraCostSummaryUseCase`) e custo só dos
 * tenants da página pelo custo por unidade do rateio, ordem `contractedSessions desc, tenantId` no SQL. Cursor
 * opaco (offset assinado, escopo = mês + plano + estado): o painel nunca manda limit/offset.
 */
export class ListInfraCostTenantsUseCase {
  private readonly now: () => Date;

  constructor(private readonly deps: ListInfraCostTenantsDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async execute(input: ListInfraCostTenantsInput = {}): Promise<ListInfraCostTenantsOutput> {
    const current = utcMonthOf(this.now());
    const month = input.month ?? current;
    const closed = month < current ? await this.deps.months.findClosedMonth(utcMonthRange(month).start) : null;
    const status = closed ? 'closed' : 'open';
    const scope = `infra-cost-tenants:${month}:${status}:${input.planSlug ?? '*'}`;
    const offset = readCursor(input.cursor, scope) ?? 0;
    const page = { planSlug: input.planSlug, offset, limit: INFRA_COST_TENANTS_PAGE_SIZE + 1 };
    const next = (count: number) => (count > INFRA_COST_TENANTS_PAGE_SIZE ? createCursor(scope, offset + INFRA_COST_TENANTS_PAGE_SIZE) : null);

    if (closed) {
      const rows = await this.deps.reports.pageClosedMonth(closed.month, page);
      const rate = closed.fx?.rate ?? null;
      return {
        month,
        status,
        basis: 'hours',
        fx: closed.fx ? { rate: closed.fx.rate, referenceDate: closed.fx.referenceDate.toISOString().slice(0, 10), source: closed.fx.source } : null,
        tenants: rows.slice(0, INFRA_COST_TENANTS_PAGE_SIZE).map((r) => ({
          tenantId: r.tenantId,
          tenantName: r.tenantName,
          planSlug: r.planSlug,
          contractedSessions: round4(r.contractedAvg),
          sessionHours: r.sessionHours,
          shared: money(r.sharedUsd, rate),
          connectedShared: null,
          projectedShared: null,
          ai: money(r.aiUsd, rate),
          total: money(r.totalUsd, rate),
        })),
        nextCursor: next(rows.length),
      };
    }

    const { calculation: c, settings } = await this.deps.summary.execute({ month });
    const fx = c.fx ? { rate: c.fx.rate, referenceDate: c.fx.referenceDate, source: c.fx.source } : null;
    const rates = c.tenantRates;
    if (c.basis === 'snapshot' || !rates) return { month, status, basis: c.basis, fx, tenants: [], nextCursor: null };

    const { start, end } = utcMonthRange(month);
    const { rows, aiUsage } = await this.deps.reports.pageOpenMonth(start, end, page);
    const aiByTenant = calculateInfraAiCosts(settings, aiUsage).byTenant;
    const rate = fx?.rate ?? null;
    const projected = month === current;
    return {
      month,
      status,
      basis: c.basis,
      fx,
      tenants: rows.slice(0, INFRA_COST_TENANTS_PAGE_SIZE).map((r) => {
        const sharedUsd = times(r.contractedAvg, rates.perContractedUsd);
        const aiUsd = aiByTenant.get(r.tenantId) ?? 0;
        return {
          tenantId: r.tenantId,
          tenantName: r.tenantName,
          planSlug: r.planSlug,
          contractedSessions: round4(r.contractedAvg),
          sessionHours: r.connectedHours,
          shared: maybeMoney(sharedUsd, rate),
          connectedShared: maybeMoney(times(r.connectedHours, rates.perSessionHourUsd), rate),
          projectedShared: projected ? maybeMoney(times(r.contractedAvg, rates.projectedPerContractedUsd), rate) : null,
          ai: money(aiUsd, rate),
          total: maybeMoney(sharedUsd === null ? null : sharedUsd + aiUsd, rate),
        };
      }),
      nextCursor: next(rows.length),
    };
  }
}
