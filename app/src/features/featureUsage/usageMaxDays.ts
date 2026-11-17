import { USAGE_MAX_DAYS } from './rules';

/**
 * Teto do período (`range.maxDays`) da última resposta de uso nesta aba, **só em memória** (some no reload; aí vale
 * `USAGE_MAX_DAYS`). Usado ao reler os filtros salvos, para não descartar um personalizado que a API aceita.
 */
let lastMaxDays: number | null = null;

export function rememberUsageMaxDays(maxDays: number): void {
  if (Number.isInteger(maxDays) && maxDays > 0) lastMaxDays = maxDays;
}

/** Teto conhecido (última resposta) ou o do painel. */
export function knownUsageMaxDays(): number {
  return lastMaxDays ?? USAGE_MAX_DAYS;
}

/** Só para testes. */
export function forgetUsageMaxDays(): void {
  lastMaxDays = null;
}
