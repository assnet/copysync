import type { PostingWindowValue } from '@/components';
import { DAY_MINUTES, windowFromSettings, windowToSettings } from '@/features/monitoring/utils/operatingWindow';
import { postingWindowValid } from '@/features/offers/utils/offerConfig';
import type {
  CreateHuntInput, Hunt, HuntFilters, HuntLimits, HuntOptions, HuntPreset, HuntSort, OfferHuntDeliveryMode,
} from '../../types';
import { HUNT_COMMISSION_PCT_MAX } from '../../types';
import { offerHunterStrings } from '../../strings';

const v = offerHunterStrings.wizard.validation;

export const WIZARD_STEPS = 3;
/** Teto da barra de preço (R$ 500); na ponta = sem limite. */
export const PRICE_MAX_CENTS = 50_000;
export const PRICE_STEP_CENTS = 500;
/** Opções de intervalo; o servidor manda o mínimo e o máximo. */
const INTERVAL_CHOICES = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440];

/** Rascunho do assistente (estado de interface; persistido por aba). */
export interface HuntWizardDraft {
  step: number;
  preset: HuntPreset;
  name: string;
  sort: HuntSort;
  categoryId: string | null;
  keyword: string;
  filters: HuntFilters;
  aiEnabled: boolean;
  topN: number | null;
  repeatAfterDays: number | null;
  intervalMinutes: number;
  postingWindow: PostingWindowValue;
  deliveryMode: OfferHuntDeliveryMode;
}

export const EMPTY_FILTERS: HuntFilters = {
  minPriceCents: null, maxPriceCents: null, minDiscountPct: null, minCommissionPct: null, commissionOperator: null, minCommissionCents: null,
  minRating: null, minSales: null, minReviews: null, onlyWithExtra: null, endsWithinDays: null,
};

/** Chave do rascunho: uma por caçada em edição, outra para a nova. */
export function wizardDraftKey(huntId?: string | null): string {
  return huntId ? `offerHunter.wizard.${huntId}` : 'offerHunter.wizard';
}

export function intervalChoices(limits: HuntLimits, current?: number): number[] {
  const list = INTERVAL_CHOICES.filter((m) => m >= limits.intervalMinutesMin && m <= limits.intervalMinutesMax);
  if (!list.includes(limits.intervalMinutesMin)) list.unshift(limits.intervalMinutesMin);
  if (current != null && !list.includes(current)) list.push(current);
  return list.sort((a, b) => a - b);
}

/** Aplica a predefinição: ordem e filtros dela (comissão inclusa) (o resto do rascunho fica). `CUSTOM` não mexe. */
export function applyPreset(draft: HuntWizardDraft, key: HuntPreset, options: HuntOptions): HuntWizardDraft {
  const preset = options.presets.find((p) => p.key === key);
  if (!preset || key === 'CUSTOM') return { ...draft, preset: key };
  return {
    ...draft,
    preset: key,
    sort: preset.definition.source.sort,
    filters: { ...EMPTY_FILTERS, ...preset.definition.local },
  };
}

export function initialDraft(options: HuntOptions, hunt?: Hunt): HuntWizardDraft {
  const { limits, gates } = options;
  if (hunt) {
    return {
      step: 0,
      preset: 'CUSTOM',
      name: hunt.name,
      sort: hunt.sort,
      categoryId: hunt.categoryId,
      keyword: hunt.keyword ?? '',
      filters: { ...EMPTY_FILTERS, ...hunt.filters },
      aiEnabled: hunt.aiEnabled,
      topN: hunt.topN,
      repeatAfterDays: hunt.repeatAfterDays,
      intervalMinutes: hunt.intervalMinutes,
      postingWindow: { window: windowFromSettings(hunt.windowStartMinute, hunt.windowEndMinute), weekdaysMask: hunt.weekdaysMask || 127 },
      deliveryMode: hunt.deliveryMode,
    };
  }
  const base: HuntWizardDraft = {
    step: 0,
    preset: 'CUSTOM',
    name: '',
    sort: 'RECOMMENDED',
    categoryId: null,
    keyword: '',
    filters: { ...EMPTY_FILTERS },
    aiEnabled: gates.aiAvailable,
    topN: limits.topNDefault,
    repeatAfterDays: limits.repeatAfterDaysDefault,
    intervalMinutes: intervalChoices(limits).find((m) => m >= 60) ?? limits.intervalMinutesMin,
    postingWindow: { window: windowFromSettings(0, DAY_MINUTES), weekdaysMask: 127 },
    deliveryMode: 'REVIEW',
  };
  const first = options.presets.find((p) => p.key !== 'CUSTOM');
  return first ? applyPreset(base, first.key, options) : base;
}

export type FieldErrors = Partial<Record<string, string>>;

/** Passo em que cada campo da API aparece (erro 422 `{ field }` leva de volta a ele). */
export function stepOfField(field: string): number {
  if (['name', 'keyword', 'categoryId', 'sort'].includes(field)) return 0;
  if (field.startsWith('filters.') || ['aiEnabled', 'topN', 'repeatAfterDays'].includes(field)) return 1;
  return 2;
}

const outside = (n: number | null, min: number, max: number, integer = true) =>
  n != null && (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n)));

/** Erros do passo (chave = nome do campo na API). Vazio = pode avançar. */
export function validateStep(step: number, d: HuntWizardDraft, limits: HuntLimits): FieldErrors {
  const e: FieldErrors = {};
  if (step === 0) {
    const name = d.name.trim();
    if (!name) e.name = v.nameRequired;
    else if (name.length > limits.nameMaxLength) e.name = v.tooLong(limits.nameMaxLength);
    if (d.keyword.trim().length > limits.keywordMaxLength) e.keyword = v.tooLong(limits.keywordMaxLength);
  }
  if (step === 1) {
    const f = d.filters;
    if (outside(f.minDiscountPct, 0, 100)) e['filters.minDiscountPct'] = v.range(0, 100);
    if (outside(f.minCommissionPct, 0, HUNT_COMMISSION_PCT_MAX, false)) e['filters.minCommissionPct'] = v.range(0, HUNT_COMMISSION_PCT_MAX);
    if (outside(f.minCommissionCents, 0, 1_000_000_000)) e['filters.minCommissionCents'] = v.range(0, 10_000_000);
    if (outside(f.minRating, 0, 5, false)) e['filters.minRating'] = v.range(0, 5);
    if (outside(f.minSales, 0, 1_000_000_000)) e['filters.minSales'] = v.range(0, 1_000_000_000);
    if (outside(f.minReviews, 0, 1_000_000_000)) e['filters.minReviews'] = v.range(0, 1_000_000_000);
    if (outside(f.endsWithinDays, 1, limits.endsWithinDaysMax)) e['filters.endsWithinDays'] = v.range(1, limits.endsWithinDaysMax);
    if (d.topN == null) e.topN = v.required;
    else if (outside(d.topN, 1, limits.topNMax)) e.topN = v.range(1, limits.topNMax);
    if (d.repeatAfterDays == null) e.repeatAfterDays = v.required;
    else if (outside(d.repeatAfterDays, limits.repeatAfterDaysMin, limits.repeatAfterDaysMax)) {
      e.repeatAfterDays = v.range(limits.repeatAfterDaysMin, limits.repeatAfterDaysMax);
    }
  }
  if (step === 2) {
    if (outside(d.intervalMinutes, limits.intervalMinutesMin, limits.intervalMinutesMax)) {
      e.intervalMinutes = v.range(limits.intervalMinutesMin, limits.intervalMinutesMax);
    }
    if (!postingWindowValid(d.postingWindow)) e.weekdaysMask = v.window;
  }
  return e;
}

/** Primeiro passo com erro (todos os passos), ou null. */
export function firstInvalidStep(d: HuntWizardDraft, limits: HuntLimits): number | null {
  for (let s = 0; s < WIZARD_STEPS; s++) if (Object.keys(validateStep(s, d, limits)).length > 0) return s;
  return null;
}

/**
 * Corpo completo de criar/editar (filtro sem valor vai como null = sem filtro). Sem `commissionBand`: o servidor
 * deriva a faixa da fonte do filtro de comissão. Operador só vai com percentual (sem % → null).
 */
export function draftToBody(d: HuntWizardDraft): CreateHuntInput {
  return {
    name: d.name.trim(),
    sort: d.sort,
    categoryId: d.categoryId,
    keyword: d.keyword.trim() || null,
    filters: {
      ...d.filters,
      commissionOperator: d.filters.minCommissionPct == null ? null : (d.filters.commissionOperator ?? 'GTE'),
      onlyWithExtra: d.filters.onlyWithExtra ? true : null,
    },
    aiEnabled: d.aiEnabled,
    topN: d.topN ?? undefined,
    repeatAfterDays: d.repeatAfterDays ?? undefined,
    deliveryMode: d.deliveryMode,
    intervalMinutes: d.intervalMinutes,
    ...windowToSettings(d.postingWindow.window),
    weekdaysMask: d.postingWindow.weekdaysMask,
  };
}

/** Houve mudança em relação ao inicial (o passo não conta). */
export function isDirty(d: HuntWizardDraft, initial: HuntWizardDraft): boolean {
  return JSON.stringify({ ...d, step: 0 }) !== JSON.stringify({ ...initial, step: 0 });
}
