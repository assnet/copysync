import type { InfraCostHourlyInput } from '../services/infraCostCalculator';

/** Agregados do mês para a conta por hora (COST-11/12): tudo que `calculateInfraCosts` pede em `hourly`. */
export type InfraCostMonthUsage = Omit<InfraCostHourlyInput, 'monthStart' | 'monthEnd'>;

/**
 * Leitura do mês `[start, end)` em UTC (`start`/`end` à meia-noite): horas por recurso
 * (`infra_resource_hours`), banda e build (`infra_usage_daily`) e, por tenant, sessão-hora e contratadas médias
 * (`tenant_session_hours`; por plano = soma dos tenants pelo plano do último dia). Agregado de plataforma
 * (super admin). `statement_timeout` 2 s; estouro → 503 `INFRA_COST_READ_UNAVAILABLE`.
 */
export interface IInfraCostUsageReader {
  readMonth(start: Date, end: Date): Promise<InfraCostMonthUsage>;
}
