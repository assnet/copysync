import type { InfraFxClosingMethod } from '../services/infraCostSettings';
import type { InfraFxRateRecord } from './IInfraCostSnapshotRepository';

/** Cotação congelada no mês fechado. */
export interface InfraCostClosedMonthFx {
  rate: number;
  /** Dia de referência (meia-noite UTC). */
  referenceDate: Date;
  source: 'override' | 'ptax' | 'sgs';
}

/** Parte de um tenant no mês fechado (`infra_cost_month_tenants`). */
export interface InfraCostClosedMonthTenant {
  tenantId: string;
  planSlug: string | null;
  contractedAvg: number;
  sessionHours: number;
  /** Rateio do compartilhado pela base padrão (contratadas, DD6). */
  sharedUsd: number;
  /** IA da plataforma do tenant no mês. */
  aiUsd: number;
  totalUsd: number;
}

/** Mês fechado (COST-15) sem a lista de tenants. */
export interface InfraCostClosedMonthSummary {
  /** Dia 1 do mês (meia-noite UTC). */
  month: Date;
  closingMethod: InfraFxClosingMethod;
  /** `null` = sem cotação (só USD). */
  fx: InfraCostClosedMonthFx | null;
  totalUsd: number;
  /** Conta do mês e preços usados (JSON congelado). */
  totals: Record<string, unknown>;
  closedAt: Date;
}

export interface InfraCostClosedMonth extends Omit<InfraCostClosedMonthSummary, 'closedAt'> {
  tenants: readonly InfraCostClosedMonthTenant[];
}

/**
 * Fechamento mensal dos custos (COST-15). Gravação idempotente: o mês já fechado nunca é reescrito
 * (nem com dois processos fechando o mesmo mês).
 */
export interface IInfraCostMonthRepository {
  hasClosedMonth(month: Date): Promise<boolean>;
  /** Grava mês + tenants numa transação; `false` = já estava fechado (nada muda). */
  saveClosedMonth(closed: InfraCostClosedMonth): Promise<boolean>;
  /** `statement_timeout` 2 s; estouro → 503 `INFRA_COST_READ_UNAVAILABLE` (lista por cliente). */
  findClosedMonth(month: Date): Promise<InfraCostClosedMonthSummary | null>;
  /**
   * Mês mais antigo (dia 1) em `[from, to)` ainda não fechado e com snapshot (`infra_resource_hours` ou
   * `tenant_session_hours`); `null` = nada a fechar.
   */
  oldestUnclosedMonth(from: Date, to: Date): Promise<Date | null>;
  /** Cotações com `referenceDate` em `[start, end)`, por data crescente. */
  fxRatesBetween(start: Date, end: Date): Promise<InfraFxRateRecord[]>;
}
