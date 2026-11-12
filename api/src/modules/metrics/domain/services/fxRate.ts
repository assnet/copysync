/**
 * Cotação USD→BRL dos custos (COST-06a). Sem env nem I/O (`fetchFirstFxRate` só orquestra o contrato).
 * Ordem: override manual → última cotação gravada (PTAX/SGS; `last_known` se a busca de hoje falhou)
 * → `null` (aviso `fx_missing` no calculador). Também o contrato das fontes (`IFxRateSource`).
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
/** Faixa aceita de BRL por USD; fora dela a leitura é descartada. */
export const INFRA_FX_MIN_RATE = 1;
export const INFRA_FX_MAX_RATE = 20;

/** Cotação lida de uma fonte automática (ainda não gravada). */
export interface FetchedFxRate {
  rate: number;
  /** `YYYY-MM-DD` do boletim. */
  referenceDate: string;
  source: 'ptax' | 'sgs';
}

/** Última cotação gravada em `infra_fx_rates`. */
export interface SavedFxRate extends FetchedFxRate {
  fetchedAt: Date;
}

/** Fonte automática da cotação; `null` em qualquer falha (rede, timeout, resposta inválida). */
export interface IFxRateSource {
  readonly name: 'ptax' | 'sgs';
  fetchLatest(signal?: AbortSignal): Promise<FetchedFxRate | null>;
}

export function isValidFxRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= INFRA_FX_MIN_RATE && rate <= INFRA_FX_MAX_RATE;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDay = (v: unknown): v is string => typeof v === 'string' && ISO_DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Primeira fonte que responder, na ordem dada (PTAX → SGS); `null` se todas falharem. */
export async function fetchFirstFxRate(sources: readonly IFxRateSource[], signal?: AbortSignal): Promise<FetchedFxRate | null> {
  for (const source of sources) {
    const rate = await source.fetchLatest(signal);
    if (rate) return rate;
  }
  return null;
}

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

export interface ResolveFxRateInput {
  fx: InfraFxSettings;
  today: Date;
  /** Última cotação gravada; ausente/`null` = nenhuma (P1). */
  saved?: SavedFxRate | null;
  /** A busca de hoje falhou (PTAX e SGS): a gravada vira `last_known`. */
  fetchFailedToday?: boolean;
}

/** Override manual → gravada (`last_known` se a busca de hoje falhou) → `null`. */
export function resolveFxRate(input: ResolveFxRateInput): ResolvedFxRate | null {
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
  const { saved } = input;
  if (saved && isValidFxRate(saved.rate) && isIsoDay(saved.referenceDate)) {
    return {
      rate: saved.rate,
      referenceDate: saved.referenceDate,
      source: input.fetchFailedToday ? 'last_known' : saved.source,
      fetchedAt: saved.fetchedAt,
      stale: isFxRateStale(saved.referenceDate, input.today),
    };
  }
  return null;
}
