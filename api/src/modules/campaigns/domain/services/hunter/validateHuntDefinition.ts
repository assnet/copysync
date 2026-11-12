import { HUNT_COMMISSION_BANDS, HUNT_SORTS, type HuntLocalFilters } from '../../hunter/HuntCandidate';
import { OFFER_HUNT_DELIVERY_MODES, type OfferHuntDefinition } from '../../hunter/OfferHunt';
import { MINUTES_PER_DAY, isValidWeekdaysMask, normalizeWindowStartMinute } from '../postingWindow';
import { HUNTER_LIMITS as L } from './hunterLimits';

export type HuntDefinitionCheck =
  | { ok: true; value: OfferHuntDefinition }
  | { ok: false; field: string; reason: string };

/** Id de categoria da fonte: só o que a Shein devolve (dígitos/letras), nunca texto livre. */
const CATEGORY_ID = /^[A-Za-z0-9_-]{1,64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

const isInt = (v: unknown, min: number, max: number): boolean => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const unset = (v: unknown): boolean => v === null || v === undefined;

/** [campo, mínimo, máximo, inteiro?] dos filtros locais numéricos. */
const FILTER_RANGES: [keyof HuntLocalFilters, number, number, boolean][] = [
  ['minPriceCents', 0, 1_000_000_000, true],
  ['maxPriceCents', 0, 1_000_000_000, true],
  ['minDiscountPct', 0, 100, true],
  ['minCommissionPct', 0, 100, false],
  ['minCommissionCents', 0, 1_000_000_000, true],
  ['minRating', 0, 5, false],
  ['minSales', 0, 1_000_000_000, true],
  ['minReviews', 0, 1_000_000_000, true],
  ['endsWithinDays', 1, L.endsWithinDaysMax, true],
];

/**
 * Valida e normaliza a definição de uma caçada (criação e edição). Puro: devolve o primeiro campo inválido
 * (o use case traduz para 422 com o campo). Normaliza: nome aparado, palavra vazia → null, início 1440 → 0.
 */
export function validateHuntDefinition(d: OfferHuntDefinition): HuntDefinitionCheck {
  const fail = (field: string, reason: string): HuntDefinitionCheck => ({ ok: false, field, reason });
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  if (!name || name.length > L.nameMaxLength || CONTROL.test(name)) return fail('name', 'Invalid name');
  if (!HUNT_SORTS.includes(d.sort)) return fail('sort', 'Invalid sort');
  if (!unset(d.commissionBand) && !HUNT_COMMISSION_BANDS.includes(d.commissionBand!)) return fail('commissionBand', 'Invalid commission band');
  if (!unset(d.categoryId) && !CATEGORY_ID.test(d.categoryId!)) return fail('categoryId', 'Invalid category');
  const keyword = typeof d.keyword === 'string' ? d.keyword.trim() : null;
  if (keyword && (keyword.length > L.keywordMaxLength || CONTROL.test(keyword))) return fail('keyword', 'Invalid keyword');
  if (typeof d.aiEnabled !== 'boolean') return fail('aiEnabled', 'Invalid AI flag');
  if (!isInt(d.topN, 1, L.topNMax)) return fail('topN', 'Invalid top N');
  if (!isInt(d.repeatAfterDays, L.repeatAfterDaysMin, L.repeatAfterDaysMax)) return fail('repeatAfterDays', 'Invalid repeat days');
  if (!OFFER_HUNT_DELIVERY_MODES.includes(d.deliveryMode)) return fail('deliveryMode', 'Invalid delivery mode');
  if (!isInt(d.intervalMinutes, L.intervalMinutesMin, L.intervalMinutesMax)) return fail('intervalMinutes', 'Invalid interval');
  if (!isInt(d.windowStartMinute, 0, MINUTES_PER_DAY)) return fail('windowStartMinute', 'Invalid window start');
  if (!isInt(d.windowEndMinute, 0, MINUTES_PER_DAY)) return fail('windowEndMinute', 'Invalid window end');
  if (d.windowStartMinute === d.windowEndMinute) return fail('windowEndMinute', 'Empty window');
  if (!isValidWeekdaysMask(d.weekdaysMask)) return fail('weekdaysMask', 'Invalid weekdays');

  const f = d.filters ?? {};
  const filters: HuntLocalFilters = {};
  for (const [key, min, max, integer] of FILTER_RANGES) {
    const v = f[key];
    if (unset(v)) continue;
    const ok = typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v));
    if (!ok) return fail(`filters.${key}`, 'Invalid filter');
    (filters as Record<string, unknown>)[key] = v;
  }
  if (!unset(f.onlyWithExtra)) {
    if (typeof f.onlyWithExtra !== 'boolean') return fail('filters.onlyWithExtra', 'Invalid filter');
    filters.onlyWithExtra = f.onlyWithExtra;
  }
  if (filters.minPriceCents != null && filters.maxPriceCents != null && filters.minPriceCents > filters.maxPriceCents) {
    return fail('filters.maxPriceCents', 'Max price below min price');
  }

  return {
    ok: true,
    value: {
      name,
      sort: d.sort,
      categoryId: d.categoryId ?? null,
      commissionBand: d.commissionBand ?? null,
      keyword: keyword || null,
      filters,
      aiEnabled: d.aiEnabled,
      topN: d.topN,
      repeatAfterDays: d.repeatAfterDays,
      deliveryMode: d.deliveryMode,
      intervalMinutes: d.intervalMinutes,
      windowStartMinute: normalizeWindowStartMinute(d.windowStartMinute, d.windowEndMinute),
      windowEndMinute: d.windowEndMinute,
      weekdaysMask: d.weekdaysMask,
    },
  };
}
