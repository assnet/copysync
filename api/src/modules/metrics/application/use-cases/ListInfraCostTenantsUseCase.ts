import { InfraCostCursorInvalidError } from '../../../../shared/errors/internal/InfraCostErrors';
import type { IInfraCostMonthRepository } from '../../domain/contracts/IInfraCostMonthRepository';
import type { IInfraCostReportReader } from '../../domain/contracts/IInfraCostReportReader';
import { calculateInfraAiCosts, type InfraMoney, type InfraSharedBasis } from '../../domain/services/infraCostCalculator';
import { createInfraCostTenantCursor, readInfraCostTenantCursor } from './infraCostTenantCursor';
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
  /** Compartilhado pela base do mês (`sharedBasis`); `null` = não rateado. */
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
  /**
   * Base do `shared` dos tenants: contratadas; Σ contratadas 0 → sessão-hora; `null` = não rateado (ou foto).
   * Mesma regra no mês aberto e no fechamento.
   */
  sharedBasis: InfraSharedBasis | null;
  /** Mês fechado: compartilhado não rateado congelado; `null` no mês aberto. */
  unallocated: InfraMoney | null;
  /** Mês fechado: itens fora do rateio (`excluded` e IA fixa), no total e fora dos tenants; `null` no aberto. */
  excluded: InfraMoney | null;
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
 * tenants da página pelo custo por unidade do rateio, ordem `lower(nome), tenantId` no SQL (o uso muda entre as
 * páginas; o nome não). Cursor keyset assinado (escopo = mês + plano + estado): o painel nunca manda
 * limit/offset; cursor inválido, expirado ou de outro escopo → 400 `INFRA_COST_CURSOR_INVALID`.
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
    const after = input.cursor ? readInfraCostTenantCursor(input.cursor, scope) : undefined;
    if (after === null) throw new InfraCostCursorInvalidError();
    const page = { planSlug: input.planSlug, after, limit: INFRA_COST_TENANTS_PAGE_SIZE + 1 };
    const next = (rows: readonly { sortKey: string; tenantId: string }[]) => {
      if (rows.length <= INFRA_COST_TENANTS_PAGE_SIZE) return null;
      const last = rows[INFRA_COST_TENANTS_PAGE_SIZE - 1];
      return createInfraCostTenantCursor(scope, { sortKey: last.sortKey, tenantId: last.tenantId });
    };

    if (closed) {
      const rows = await this.deps.reports.pageClosedMonth(closed.month, page);
      const rate = closed.fx?.rate ?? null;
      const frozen = readClosedAllocation(closed.totals);
      return {
        month,
        status,
        basis: 'hours',
        fx: closed.fx ? { rate: closed.fx.rate, referenceDate: closed.fx.referenceDate.toISOString().slice(0, 10), source: closed.fx.source } : null,
        sharedBasis: frozen.sharedBasis,
        unallocated: money(frozen.unallocatedUsd, rate),
        excluded: money(frozen.excludedUsd, rate),
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
        nextCursor: next(rows),
      };
    }

    const { calculation: c, settings } = await this.deps.summary.execute({ month });
    const fx = c.fx ? { rate: c.fx.rate, referenceDate: c.fx.referenceDate, source: c.fx.source } : null;
    const rates = c.tenantRates;
    const empty = { unallocated: null, excluded: null };
    if (c.basis === 'snapshot' || !rates) return { month, status, basis: c.basis, fx, sharedBasis: null, ...empty, tenants: [], nextCursor: null };

    const { start, end } = utcMonthRange(month);
    const { rows, aiUsage } = await this.deps.reports.pageOpenMonth(start, end, page);
    const aiByTenant = calculateInfraAiCosts(settings, aiUsage).byTenant;
    const rate = fx?.rate ?? null;
    const projected = month === current;
    // Mesma base do fechamento: contratadas; Σ 0 → sessão-hora; sem as duas → não rateado
    const byHours = rates.sharedBasis === 'session_hours';
    return {
      month,
      status,
      basis: c.basis,
      fx,
      sharedBasis: rates.sharedBasis,
      ...empty,
      tenants: rows.slice(0, INFRA_COST_TENANTS_PAGE_SIZE).map((r) => {
        const sharedUsd = rates.sharedBasis === null ? null
          : byHours ? times(r.connectedHours, rates.perSessionHourUsd) : times(r.contractedAvg, rates.perContractedUsd);
        const projectedUsd = byHours
          ? times(r.connectedHours, rates.projectedPerSessionHourUsd)
          : times(r.contractedAvg, rates.projectedPerContractedUsd);
        const aiUsd = aiByTenant.get(r.tenantId) ?? 0;
        return {
          tenantId: r.tenantId,
          tenantName: r.tenantName,
          planSlug: r.planSlug,
          contractedSessions: round4(r.contractedAvg),
          sessionHours: r.connectedHours,
          shared: maybeMoney(sharedUsd, rate),
          connectedShared: maybeMoney(times(r.connectedHours, rates.perSessionHourUsd), rate),
          projectedShared: projected && rates.sharedBasis !== null ? maybeMoney(projectedUsd, rate) : null,
          ai: money(aiUsd, rate),
          total: maybeMoney(sharedUsd === null ? null : sharedUsd + aiUsd, rate),
        };
      }),
      nextCursor: next(rows),
    };
  }
}

/**
 * Do JSON congelado (`infra_cost_months.totals`): base do rateio pelos avisos e `allocation` (ausente = 0).
 * Ilegível nunca lança: o mês fechado continua listável.
 */
function readClosedAllocation(totals: Record<string, unknown>): { sharedBasis: InfraSharedBasis | null; unallocatedUsd: number; excludedUsd: number } {
  const calc = totals.calculation as { warnings?: unknown } | undefined;
  const codes = new Set(Array.isArray(calc?.warnings) ? calc.warnings.map((w) => (w as { code?: unknown })?.code) : []);
  const alloc = (totals.allocation ?? {}) as { unallocatedUsd?: unknown; excludedUsd?: unknown };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    sharedBasis: codes.has('shared_unallocated') ? null : codes.has('shared_by_session_hours') ? 'session_hours' : 'contracted',
    unallocatedUsd: num(alloc.unallocatedUsd),
    excludedUsd: num(alloc.excludedUsd),
  };
}
