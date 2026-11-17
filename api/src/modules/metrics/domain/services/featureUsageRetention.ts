/**
 * Adoção, recorrência e retenção de um recurso (P3; spec "Medidas", USAGE-21). Função pura sobre as linhas do
 * recurso já recortadas (período, tipo e contas) e o conjunto de contas com direito ao recurso hoje.
 */

/** Linha mínima: a mesma forma de `FeatureUsageRow` (dia ou início do bucket, dias ativos dentro da linha). */
export interface RetentionRow {
  day: string;
  tenantId: string;
  activeDays: number;
}

/** N de "usou em ≥ N dias distintos" (spec: 2, 3 ou 5; padrão 3). */
export const RECURRING_DAYS_OPTIONS = [2, 3, 5] as const;
export type RecurringDays = (typeof RECURRING_DAYS_OPTIONS)[number];
export const DEFAULT_RECURRING_DAYS: RecurringDays = 3;

export interface FeatureRetentionInput {
  /** Linhas do recurso no período atual. */
  current: readonly RetentionRow[];
  /** Linhas do recurso no período anterior. */
  previous: readonly RetentionRow[];
  /** Contas do recorte com direito ao recurso hoje (`null` = direito não lido: adoção `null`). */
  eligible: ReadonlySet<string> | null;
  recurringDays: RecurringDays;
  /** O período anterior está inteiro dentro dos dados do recurso (mesma regra da tendência). */
  hasPreviousBase: boolean;
}

export interface FeatureRetentionStats {
  /** Contas com direito no recorte; `null` sem leitura de direito. */
  eligibleTenants: number | null;
  /** Contas que usaram ÷ contas com direito, limitada a 1; `null` com 0 contas com direito. */
  adoption: number | null;
  /** Contas que usaram sem ter direito hoje (contam no numerador da adoção; sinal para o painel). */
  usedWithoutEligibility: number;
  /** Contas que usaram em ≥ N dias distintos do período. */
  recurringTenants: number;
  /** Contas que usaram no período anterior e de novo no atual; `null` sem período anterior completo. */
  retainedTenants: number | null;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Dias distintos por conta. Numa linha por dia vale 1 por dia; numa linha já agrupada (semana/mês), os dias
 * ativos da linha. Tipos diferentes no mesmo dia/bucket não somam dia (vale o maior, como a lista de contas).
 */
export function activeDaysByTenant(rows: readonly RetentionRow[]): Map<string, number> {
  const byTenant = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const buckets = byTenant.get(row.tenantId) ?? new Map<string, number>();
    buckets.set(row.day, Math.max(buckets.get(row.day) ?? 0, row.activeDays));
    byTenant.set(row.tenantId, buckets);
  }
  const out = new Map<string, number>();
  for (const [tenantId, buckets] of byTenant) {
    let days = 0;
    for (const n of buckets.values()) days += n;
    out.set(tenantId, days);
  }
  return out;
}

export function featureRetentionStats(input: FeatureRetentionInput): FeatureRetentionStats {
  const days = activeDaysByTenant(input.current);
  const used = [...days.keys()];

  let recurringTenants = 0;
  for (const n of days.values()) if (n >= input.recurringDays) recurringTenants += 1;

  let retainedTenants: number | null = null;
  if (input.hasPreviousBase) {
    const before = new Set(input.previous.map((r) => r.tenantId));
    retainedTenants = used.filter((t) => before.has(t)).length;
  }

  const eligible = input.eligible;
  const usedWithoutEligibility = eligible ? used.filter((t) => !eligible.has(t)).length : 0;
  const eligibleTenants = eligible ? eligible.size : null;
  const adoption = eligible && eligible.size > 0 ? round4(Math.min(1, used.length / eligible.size)) : null;

  return { eligibleTenants, adoption, usedWithoutEligibility, recurringTenants, retainedTenants };
}
