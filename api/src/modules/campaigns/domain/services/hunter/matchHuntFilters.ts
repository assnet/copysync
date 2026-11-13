import type { HuntCandidate, HuntCommissionOperator, HuntFilterKey, HuntLocalFilters, HuntRejectionCounts, HuntRejectionKey } from '../../hunter/HuntCandidate';

export type { HuntFilterKey, HuntRejectionCounts, HuntRejectionKey };

const DAY_MS = 86_400_000;

/** GT `pct > v` · GTE `pct >= v` · LT `pct < v`; percentual não finito (dado ausente) não passa. */
export function commissionPasses(pct: number, op: HuntCommissionOperator, v: number): boolean {
  if (!Number.isFinite(pct)) return false;
  return op === 'GT' ? pct > v : op === 'LT' ? pct < v : pct >= v;
}

function set(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Filtros locais (HUNT-03) que recusam o candidato, na ordem fixa dos campos; vazio = passa. Filtro
 * ausente/null = não filtra. Filtro ligado e dado ausente no candidato (preço, nota, data de fim) = recusa
 * por aquela chave. Comissão % (com `commissionOperator`, ausente = GTE) e R$ olham a de cliente novo.
 * `endsWithinDays`: termina entre `now` e `now + N dias` (já terminada = fora).
 */
export function huntFilterRejections(c: HuntCandidate, f: HuntLocalFilters, now: Date): HuntFilterKey[] {
  const out: HuntFilterKey[] = [];
  if (set(f.minPriceCents) && (c.priceCents === null || c.priceCents < f.minPriceCents)) out.push('minPriceCents');
  if (set(f.maxPriceCents) && (c.priceCents === null || c.priceCents > f.maxPriceCents)) out.push('maxPriceCents');
  if (set(f.minDiscountPct) && c.discountPct < f.minDiscountPct) out.push('minDiscountPct');
  if (set(f.minCommissionPct) && !commissionPasses(c.commissionNewPct, f.commissionOperator ?? 'GTE', f.minCommissionPct)) {
    out.push('minCommissionPct');
  }
  if (set(f.minCommissionCents) && c.commissionNewCents < f.minCommissionCents) out.push('minCommissionCents');
  if (set(f.minRating) && (c.rating === null || c.rating < f.minRating)) out.push('minRating');
  if (set(f.minSales) && c.sales < f.minSales) out.push('minSales');
  if (set(f.minReviews) && c.reviews < f.minReviews) out.push('minReviews');
  if (f.onlyWithExtra === true && c.extraCommissionCents <= 0) out.push('onlyWithExtra');
  if (set(f.endsWithinDays)) {
    const ends = c.campaignEndsAt?.getTime();
    if (ends === undefined || ends < now.getTime() || ends > now.getTime() + f.endsWithinDays * DAY_MS) out.push('endsWithinDays');
  }
  return out;
}

/** Passa em todos os filtros locais (= nenhuma recusa em `huntFilterRejections`). */
export function matchHuntFilters(c: HuntCandidate, f: HuntLocalFilters, now: Date): boolean {
  return huntFilterRejections(c, f, now).length === 0;
}

/** Soma uma recusa por chave no contador (mutável, só dentro de uma execução). */
export function countHuntRejections(counts: HuntRejectionCounts, keys: readonly HuntRejectionKey[]): void {
  for (const k of keys) counts[k] = (counts[k] ?? 0) + 1;
}
