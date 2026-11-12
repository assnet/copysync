import type { HuntCandidate, HuntLocalFilters } from '../../hunter/HuntCandidate';

const DAY_MS = 86_400_000;

function set(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Filtros locais (HUNT-03). Filtro ausente/null = não filtra. Filtro ligado e dado ausente no candidato
 * (preço, nota, data de fim) = não passa. Comissão mínima (% e R$) olha a de cliente novo, a principal do
 * painel Shein. `endsWithinDays`: termina entre `now` e `now + N dias` (já terminada = fora).
 */
export function matchHuntFilters(c: HuntCandidate, f: HuntLocalFilters, now: Date): boolean {
  if (set(f.minPriceCents) && (c.priceCents === null || c.priceCents < f.minPriceCents)) return false;
  if (set(f.maxPriceCents) && (c.priceCents === null || c.priceCents > f.maxPriceCents)) return false;
  if (set(f.minDiscountPct) && c.discountPct < f.minDiscountPct) return false;
  if (set(f.minCommissionPct) && c.commissionNewPct < f.minCommissionPct) return false;
  if (set(f.minCommissionCents) && c.commissionNewCents < f.minCommissionCents) return false;
  if (set(f.minRating) && (c.rating === null || c.rating < f.minRating)) return false;
  if (set(f.minSales) && c.sales < f.minSales) return false;
  if (set(f.minReviews) && c.reviews < f.minReviews) return false;
  if (f.onlyWithExtra === true && c.extraCommissionCents <= 0) return false;
  if (set(f.endsWithinDays)) {
    if (!c.campaignEndsAt) return false;
    const ends = c.campaignEndsAt.getTime();
    if (ends < now.getTime() || ends > now.getTime() + f.endsWithinDays * DAY_MS) return false;
  }
  return true;
}
