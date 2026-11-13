import { HUNT_COMMISSION_OPERATORS, HUNT_COMMISSION_PCT_MAX, HUNT_SORTS, type HuntFilterKey, type HuntLocalFilters } from '../../hunter/HuntCandidate';
import { isHuntProvider, type HuntCapabilities, type HuntSourceOptions } from '../../hunter/HuntProvider';
import { huntCapabilities } from './huntCapabilities';
import { OFFER_HUNT_DELIVERY_MODES, type OfferHuntDefinition } from '../../hunter/OfferHunt';
import { MINUTES_PER_DAY, isValidWeekdaysMask, normalizeWindowStartMinute } from '../postingWindow';
import { HUNTER_LIMITS as L } from './hunterLimits';

/** Teto da intenção dada à IA (AI-02). */
export const HUNT_AI_INTENT_MAX = 120;

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
  ['minCommissionPct', 0, HUNT_COMMISSION_PCT_MAX, false],
  ['minCommissionCents', 0, 1_000_000_000, true],
  ['minRating', 0, 5, false],
  ['minSales', 0, 1_000_000_000, true],
  ['minReviews', 0, 1_000_000_000, true],
  ['endsWithinDays', 1, L.endsWithinDaysMax, true],
];

type SourceOptionsCheck = { ok: true; value: HuntSourceOptions | null } | { ok: false; field: string; reason: string };

/**
 * Filtros da fonte por marca. Shein guarda a ordenação na coluna `sort`: `sourceOptions` precisa vir vazio. Demais
 * marcas: `sort` entre `capabilities.sorts` (ausente = padrão da marca) e flags só se a marca declara o filtro.
 */
function checkSourceOptions(caps: HuntCapabilities, o: HuntSourceOptions | null | undefined): SourceOptionsCheck {
  const fail = (key: string, reason: string): SourceOptionsCheck => ({ ok: false, field: `sourceOptions.${key}`, reason });
  if (o !== null && o !== undefined && (typeof o !== 'object' || Array.isArray(o))) return { ok: false, field: 'sourceOptions', reason: 'Invalid source options' };
  const src = o ?? {};
  if (caps.provider === 'SHEIN') {
    for (const k of ['sort', 'extraEarningsOnly', 'bestSellersOnly'] as const) if (!unset(src[k])) return fail(k, 'Not supported for provider');
    return { ok: true, value: null };
  }
  const out: HuntSourceOptions = {};
  if (!unset(src.sort) && (typeof src.sort !== 'string' || !caps.sorts.includes(src.sort))) return fail('sort', 'Invalid sort');
  out.sort = src.sort ?? caps.defaultSort;
  for (const k of ['extraEarningsOnly', 'bestSellersOnly'] as const) {
    const v = src[k];
    if (unset(v)) continue;
    if (typeof v !== 'boolean') return fail(k, 'Invalid source filter');
    if (!caps.sourceFilters.includes(k)) return fail(k, 'Not supported for provider');
    out[k] = v;
  }
  return { ok: true, value: out };
}

/**
 * Valida e normaliza a definição de uma caçada (criação e edição) contra as capacidades da marca. Puro: devolve o
 * primeiro campo inválido (o use case traduz para 422 com o campo). Normaliza: nome aparado, palavra vazia → null,
 * início 1440 → 0, comissão % sem operador → GTE (sem % → operador null), `commissionBand` sempre `ANY` (a do corpo é
 * ignorada), intenção da IA aparada (vazia → null). Filtro/campo que a marca não oferece = erro do campo.
 */
export function validateHuntDefinition(d: OfferHuntDefinition): HuntDefinitionCheck {
  const fail = (field: string, reason: string): HuntDefinitionCheck => ({ ok: false, field, reason });
  if (!isHuntProvider(d.provider)) return fail('provider', 'Invalid provider');
  const caps = huntCapabilities(d.provider);
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  if (!name || name.length > L.nameMaxLength || CONTROL.test(name)) return fail('name', 'Invalid name');
  if (!HUNT_SORTS.includes(d.sort)) return fail('sort', 'Invalid sort');
  // Marca que ordena por `sourceOptions.sort` não usa a coluna Shein
  if (caps.provider !== 'SHEIN' && d.sort !== 'RECOMMENDED') return fail('sort', 'Not supported for provider');
  if (!unset(d.categoryId) && !CATEGORY_ID.test(d.categoryId!)) return fail('categoryId', 'Invalid category');
  if (!unset(d.categoryId) && !caps.sourceFilters.includes('category')) return fail('categoryId', 'Not supported for provider');
  const keyword = typeof d.keyword === 'string' ? d.keyword.trim() : null;
  if (keyword && (keyword.length > L.keywordMaxLength || CONTROL.test(keyword))) return fail('keyword', 'Invalid keyword');
  if (keyword && !caps.sourceFilters.includes('keyword')) return fail('keyword', 'Not supported for provider');
  const source = checkSourceOptions(caps, d.sourceOptions);
  if (!source.ok) return fail(source.field, source.reason);
  if (typeof d.aiEnabled !== 'boolean') return fail('aiEnabled', 'Invalid AI flag');
  const aiConfigured = d.aiConfigured ?? false;
  if (typeof aiConfigured !== 'boolean') return fail('aiConfigured', 'Invalid AI flag');
  if (!unset(d.aiIntent) && typeof d.aiIntent !== 'string') return fail('aiIntent', 'Invalid AI intent');
  const aiIntent = typeof d.aiIntent === 'string' ? d.aiIntent.trim() : '';
  if (aiIntent.length > HUNT_AI_INTENT_MAX || CONTROL.test(aiIntent)) return fail('aiIntent', 'Invalid AI intent');
  if (!isInt(d.topN, 1, L.topNMax)) return fail('topN', 'Invalid top N');
  if (!isInt(d.repeatAfterDays, L.repeatAfterDaysMin, L.repeatAfterDaysMax)) return fail('repeatAfterDays', 'Invalid repeat days');
  if (!OFFER_HUNT_DELIVERY_MODES.includes(d.deliveryMode)) return fail('deliveryMode', 'Invalid delivery mode');
  if (!isInt(d.intervalMinutes, L.intervalMinutesMin, L.intervalMinutesMax)) return fail('intervalMinutes', 'Invalid interval');
  if (!isInt(d.windowStartMinute, 0, MINUTES_PER_DAY)) return fail('windowStartMinute', 'Invalid window start');
  if (!isInt(d.windowEndMinute, 0, MINUTES_PER_DAY)) return fail('windowEndMinute', 'Invalid window end');
  // Depois da normalização: início 1440 + fim 0 vira 0/0 (janela vazia)
  const windowStartMinute = normalizeWindowStartMinute(d.windowStartMinute, d.windowEndMinute);
  if (windowStartMinute === d.windowEndMinute) return fail('windowEndMinute', 'Empty window');
  if (!isValidWeekdaysMask(d.weekdaysMask)) return fail('weekdaysMask', 'Invalid weekdays');

  const f = d.filters ?? {};
  const filters: HuntLocalFilters = {};
  for (const [key, min, max, integer] of FILTER_RANGES) {
    const v = f[key];
    if (unset(v)) continue;
    const ok = typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v));
    if (!ok) return fail(`filters.${key}`, 'Invalid filter');
    if (!caps.localFilters.includes(key as HuntFilterKey)) return fail(`filters.${key}`, 'Not supported for provider');
    (filters as Record<string, unknown>)[key] = v;
  }
  if (!unset(f.onlyWithExtra)) {
    if (typeof f.onlyWithExtra !== 'boolean') return fail('filters.onlyWithExtra', 'Invalid filter');
    if (f.onlyWithExtra && !caps.localFilters.includes('onlyWithExtra')) return fail('filters.onlyWithExtra', 'Not supported for provider');
    filters.onlyWithExtra = f.onlyWithExtra;
  }
  if (!unset(f.commissionOperator) && !HUNT_COMMISSION_OPERATORS.includes(f.commissionOperator!)) {
    return fail('filters.commissionOperator', 'Invalid filter');
  }
  if (filters.minCommissionPct != null) filters.commissionOperator = f.commissionOperator ?? 'GTE';
  if (filters.minPriceCents != null && filters.maxPriceCents != null && filters.minPriceCents > filters.maxPriceCents) {
    return fail('filters.maxPriceCents', 'Max price below min price');
  }

  return {
    ok: true,
    value: {
      provider: d.provider,
      name,
      sort: d.sort,
      categoryId: d.categoryId ?? null,
      // Faixa da fonte filtra a recompra: nunca usada (sempre ANY); a do corpo é ignorada
      commissionBand: 'ANY',
      keyword: keyword || null,
      sourceOptions: source.value,
      filters,
      aiEnabled: d.aiEnabled,
      aiConfigured,
      aiIntent: aiIntent || null,
      topN: d.topN,
      repeatAfterDays: d.repeatAfterDays,
      deliveryMode: d.deliveryMode,
      intervalMinutes: d.intervalMinutes,
      windowStartMinute,
      windowEndMinute: d.windowEndMinute,
      weekdaysMask: d.weekdaysMask,
    },
  };
}
