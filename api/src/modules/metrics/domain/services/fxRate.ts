/**
 * Cotação USD→BRL dos custos (COST-06a). Função pura: sem env nem I/O.
 * P1: só o override manual da configuração. A T12b acrescenta a cotação gravada (PTAX/SGS) e
 * `last_known` depois do override; sem nenhuma → `null` (aviso `fx_missing` no calculador).
 */
import type { InfraFxSettings } from './infraCostSettings';

export type InfraFxSource = 'override' | 'ptax' | 'sgs' | 'last_known';

export interface ResolvedFxRate {
  /** BRL por USD. */
  rate: number;
  /** `YYYY-MM-DD`. */
  referenceDate: string;
  source: InfraFxSource;
  /** Quando a cotação foi buscada; `null` no override. */
  fetchedAt: Date | null;
  /** `referenceDate` com mais de `INFRA_FX_STALE_DAYS` dias corridos antes de hoje (UTC). */
  stale: boolean;
}

export const INFRA_FX_STALE_DAYS = 5;

const DAY_MS = 86_400_000;

/** Dias corridos entre `referenceDate` e o dia UTC de `today` (negativo = data futura). */
function daysSince(referenceDate: string, today: Date): number {
  const ref = Date.parse(`${referenceDate}T00:00:00Z`);
  const day = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((day - ref) / DAY_MS);
}

export function isFxRateStale(referenceDate: string, today: Date): boolean {
  return daysSince(referenceDate, today) > INFRA_FX_STALE_DAYS;
}

/** Override manual → (T12b: gravada → `last_known`) → `null`. */
export function resolveFxRate(input: { fx: InfraFxSettings; today: Date }): ResolvedFxRate | null {
  const { override } = input.fx;
  if (override) {
    return {
      rate: override.rate,
      referenceDate: override.date,
      source: 'override',
      fetchedAt: null,
      stale: isFxRateStale(override.date, input.today),
    };
  }
  return null;
}
