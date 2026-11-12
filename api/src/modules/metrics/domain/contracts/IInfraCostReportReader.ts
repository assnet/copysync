import type { InfraAiUsageRow, InfraTenantMonthUsage } from '../services/infraCostCalculator';
import type { InfraCostClosedMonthSummary } from './IInfraCostMonthRepository';

/** Última linha da página anterior (keyset): `sortKey` é o texto devolvido pelo próprio SQL. */
export interface InfraCostTenantPageAfter {
  sortKey: string;
  tenantId: string;
}

/** Página pedida pelo servidor (keyset do cursor assinado + tamanho fixo); `planSlug` ausente = todos. */
export interface InfraCostTenantPageQuery {
  planSlug?: string;
  /** Ausente = 1ª página. */
  after?: InfraCostTenantPageAfter;
  limit: number;
}

/** Tenant do mês aberto (`tenant_session_hours`) com o nome; nenhum outro dado do tenant. */
export interface InfraCostOpenMonthTenantRow extends InfraTenantMonthUsage {
  tenantName: string;
  /** Chave da ordenação (`lower(name)`), para o cursor. */
  sortKey: string;
}

/** Tenant do mês fechado (`infra_cost_month_tenants`, valores congelados) com o nome. */
export interface InfraCostClosedMonthTenantRow {
  tenantId: string;
  tenantName: string;
  planSlug: string | null;
  contractedAvg: number;
  sessionHours: number;
  sharedUsd: number;
  aiUsd: number;
  totalUsd: number;
  /** Chave da ordenação (`totalUsd` como texto do `numeric`), para o cursor. */
  sortKey: string;
}

/** Soma por plano de um mês fechado. */
export interface InfraCostClosedMonthPlanRow {
  planSlug: string | null;
  tenants: number;
  sharedUsd: number;
  aiUsd: number;
  totalUsd: number;
}

export interface InfraCostClosedMonthHistoryRow extends Omit<InfraCostClosedMonthSummary, 'totals'> {
  /** `totals.calculation.totalIsPartial` congelado (ausente/ilegível = `false`). */
  totalIsPartial: boolean;
  /** `totals.allocation` congelado (ausente = 0): compartilhado não rateado e itens fora do rateio. */
  unallocatedUsd: number;
  excludedUsd: number;
  plans: InfraCostClosedMonthPlanRow[];
}

/**
 * Leituras das abas Por cliente e Histórico (COST-14/15), super admin. Agregado de plataforma: lista todos os
 * tenants; do tenant só sai id e nome. `statement_timeout` 2 s; estouro → 503 `INFRA_COST_READ_UNAVAILABLE`.
 */
export interface IInfraCostReportReader {
  /**
   * Mês aberto `[start, end)`: ordem estável `lower(name), tenantId` (não muda com o uso entre as páginas),
   * plano = o do último dia com plano; `limit` linhas depois de `after`. `aiUsage` = IA da plataforma só dos tenants da página.
   */
  pageOpenMonth(start: Date, end: Date, page: InfraCostTenantPageQuery): Promise<{
    rows: InfraCostOpenMonthTenantRow[];
    aiUsage: InfraAiUsageRow[];
  }>;
  /** Mês fechado (dia 1): ordem `totalUsd desc, tenantId` (valores congelados), `limit` linhas depois de `after`. */
  pageClosedMonth(month: Date, page: InfraCostTenantPageQuery): Promise<InfraCostClosedMonthTenantRow[]>;
  /** Meses fechados com `month` em `[start, end)`, por mês crescente, com a soma por plano. */
  listClosedMonths(start: Date, end: Date): Promise<InfraCostClosedMonthHistoryRow[]>;
}
