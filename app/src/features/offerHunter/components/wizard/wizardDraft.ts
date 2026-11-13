import type { PostingWindowValue } from '@/components';
import { DAY_MINUTES, windowFromSettings, windowToSettings } from '@/features/monitoring/utils/operatingWindow';
import { postingWindowValid } from '@/features/offers/utils/offerConfig';
import type {
  CreateHuntInput, Hunt, HuntAiSuggestion, HuntCapabilities, HuntFilters, HuntLimits, HuntOptions, HuntPreset, HuntProvider,
  HuntSort, HuntSourceOptions, OfferHuntDeliveryMode,
} from '../../types';
import { HUNT_AI_INTENT_MAX, HUNT_COMMISSION_PCT_MAX, HUNT_SORTS } from '../../types';
import { offerHunterStrings } from '../../strings';
import { EMPTY_SOURCE_OPTIONS, capabilitiesOf, fallbackCapabilities, hasSourceFilter, providerOf, sortInColumn } from '../../providers';

const v = offerHunterStrings.wizard.validation;

/** Loja → O que caçar → Refino → Quando e onde. */
export const WIZARD_STEPS = 4;
/** Versão do rascunho persistido (v3 = loja + IA; rascunho antigo é descartado). */
export const WIZARD_DRAFT_VERSION = 3;
/** Teto da barra de preço (R$ 500); na ponta = sem limite. */
export const PRICE_MAX_CENTS = 50_000;
export const PRICE_STEP_CENTS = 500;
/** Opções de intervalo; o servidor manda o mínimo e o máximo. */
const INTERVAL_CHOICES = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440];

/** "Deixar a IA decidir os filtros": escolhas do usuário + dicas por campo da última sugestão aplicada. */
export interface HuntWizardAiState {
  on: boolean;
  intent: string;
  pickProduct: boolean;
  /** Uma sugestão foi aplicada ao rascunho (vai como `aiConfigured`). */
  applied: boolean;
  /** Caminho do campo (`filters.minPriceCents`…) → motivo da IA ('' = sem motivo). Some quando o campo é mexido. */
  hints: Record<string, string>;
  /** Campos que a IA sugeriu e a API descartou (caminhos). */
  dropped: string[];
}

export const EMPTY_AI_STATE: HuntWizardAiState = { on: false, intent: '', pickProduct: false, applied: false, hints: {}, dropped: [] };

/** Rascunho do assistente (estado de interface; persistido por aba). */
export interface HuntWizardDraft {
  step: number;
  /** null = loja ainda não escolhida (nova caçada). Fixa na edição. */
  provider: HuntProvider | null;
  /** Loja cujas predefinições já preencheram o rascunho (trocar de loja recomeça os filtros). */
  presetFor: HuntProvider | null;
  preset: HuntPreset;
  name: string;
  /** Ordem da Shein (coluna `sort`); nas demais lojas fica RECOMMENDED e a ordem vai em `sourceOptions.sort`. */
  sort: HuntSort;
  categoryId: string | null;
  keyword: string;
  sourceOptions: HuntSourceOptions;
  filters: HuntFilters;
  ai: HuntWizardAiState;
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

const isHuntSort = (s: string): s is HuntSort => (HUNT_SORTS as readonly string[]).includes(s);

/**
 * Aplica a predefinição: ordem e filtros dela (comissão inclusa) (o resto do rascunho fica). `CUSTOM` não mexe.
 * Shein: ordem na coluna `sort`; demais lojas: em `sourceOptions.sort`.
 */
export function applyPreset(draft: HuntWizardDraft, key: HuntPreset, options: HuntOptions): HuntWizardDraft {
  const preset = options.presets.find((p) => p.key === key);
  if (!preset || key === 'CUSTOM') return { ...draft, preset: key };
  const sort = preset.definition.source.sort;
  const provider = providerOf(options);
  return {
    ...draft,
    preset: key,
    ...(sortInColumn(provider)
      ? { sort: isHuntSort(sort) ? sort : 'RECOMMENDED' }
      : { sourceOptions: { ...draft.sourceOptions, sort } }),
    filters: { ...EMPTY_FILTERS, ...preset.definition.local },
  };
}

/**
 * Prepara o rascunho para a loja de `options`: zera ordem, categoria, filtros da fonte e locais, dicas da IA, e
 * aplica a 1ª predefinição da loja. Nome e palavra-chave ficam.
 */
export function seedProvider(draft: HuntWizardDraft, options: HuntOptions): HuntWizardDraft {
  const provider = providerOf(options);
  const caps = capabilitiesOf(options, provider);
  const base: HuntWizardDraft = {
    ...draft,
    provider,
    presetFor: provider,
    preset: 'CUSTOM',
    sort: 'RECOMMENDED',
    categoryId: null,
    sourceOptions: { ...EMPTY_SOURCE_OPTIONS, sort: sortInColumn(provider) ? null : caps.defaultSort },
    filters: { ...EMPTY_FILTERS },
    ai: { ...draft.ai, applied: false, hints: {}, dropped: [] },
  };
  const first = options.presets.find((p) => p.key !== 'CUSTOM');
  return first ? applyPreset(base, first.key, options) : base;
}

export function initialDraft(options: HuntOptions, hunt?: Hunt): HuntWizardDraft {
  const { limits, gates } = options;
  if (hunt) {
    const provider = providerOf(hunt);
    return {
      step: 0,
      provider,
      presetFor: provider,
      preset: 'CUSTOM',
      name: hunt.name,
      sort: hunt.sort,
      categoryId: hunt.categoryId,
      keyword: hunt.keyword ?? '',
      sourceOptions: { ...EMPTY_SOURCE_OPTIONS, ...(hunt.sourceOptions ?? {}) },
      filters: { ...EMPTY_FILTERS, ...hunt.filters },
      ai: { ...EMPTY_AI_STATE, on: Boolean(hunt.aiConfigured), applied: Boolean(hunt.aiConfigured), intent: hunt.aiIntent ?? '' },
      aiEnabled: hunt.aiEnabled,
      topN: hunt.topN,
      repeatAfterDays: hunt.repeatAfterDays,
      intervalMinutes: hunt.intervalMinutes,
      postingWindow: { window: windowFromSettings(hunt.windowStartMinute, hunt.windowEndMinute), weekdaysMask: hunt.weekdaysMask || 127 },
      deliveryMode: hunt.deliveryMode,
    };
  }
  return {
    step: 0,
    provider: null,
    presetFor: null,
    preset: 'CUSTOM',
    name: '',
    sort: 'RECOMMENDED',
    categoryId: null,
    keyword: '',
    sourceOptions: { ...EMPTY_SOURCE_OPTIONS },
    filters: { ...EMPTY_FILTERS },
    ai: { ...EMPTY_AI_STATE },
    aiEnabled: gates.aiAvailable,
    topN: limits.topNDefault,
    repeatAfterDays: limits.repeatAfterDaysDefault,
    intervalMinutes: intervalChoices(limits).find((m) => m >= 60) ?? limits.intervalMinutesMin,
    postingWindow: { window: windowFromSettings(0, DAY_MINUTES), weekdaysMask: 127 },
    deliveryMode: 'REVIEW',
  };
}

const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof HuntFilters)[];
const SOURCE_KEYS = Object.keys(EMPTY_SOURCE_OPTIONS) as (keyof HuntSourceOptions)[];

/** Caminhos (como nos `reasons` da API) cujo valor mudou entre dois rascunhos. */
function changedPaths(a: HuntWizardDraft, b: HuntWizardDraft): string[] {
  const out: string[] = [];
  for (const k of ['name', 'sort', 'categoryId', 'keyword', 'aiEnabled', 'topN'] as const) if (a[k] !== b[k]) out.push(k);
  for (const k of FILTER_KEYS) {
    if ((a.filters[k] ?? null) !== (b.filters[k] ?? null)) out.push(k === 'commissionOperator' ? 'filters.minCommissionPct' : `filters.${k}`);
  }
  for (const k of SOURCE_KEYS) if ((a.sourceOptions[k] ?? null) !== (b.sourceOptions[k] ?? null)) out.push(`sourceOptions.${k}`);
  return out;
}

/** Campo mexido pelo usuário perde a marca "Sugerido pela IA". */
export function dropChangedHints(prev: HuntWizardDraft, next: HuntWizardDraft): HuntWizardDraft {
  const keys = Object.keys(next.ai.hints);
  if (keys.length === 0) return next;
  const changed = changedPaths(prev, next);
  const gone = keys.filter((k) => changed.includes(k) || (k === 'filters.maxPriceCents' && changed.includes('filters.minPriceCents')));
  if (gone.length === 0) return next;
  const hints = { ...next.ai.hints };
  gone.forEach((k) => delete hints[k]);
  return { ...next, ai: { ...next.ai, hints } };
}

/**
 * Aplica a sugestão da IA: filtros (da fonte e locais) trocados pelos dela (o que ela não decidiu fica sem filtro);
 * nome, categoria, palavra, ranking por IA e ofertas por busca só mudam quando ela decidiu. Cada campo preenchido
 * ganha a dica com o motivo. Nada é salvo aqui.
 */
export function applyAiSuggestion(draft: HuntWizardDraft, s: HuntAiSuggestion, options: HuntOptions): HuntWizardDraft {
  const caps = capabilitiesOf(options, s.draft.provider);
  const g = s.draft;
  const hints: Record<string, string> = {};
  const mark = (path: string) => { hints[path] = s.reasons[path] ?? ''; };
  if (g.name) mark('name');
  if (g.categoryId) mark('categoryId');
  if (g.keyword) mark('keyword');
  if (g.aiEnabled != null) mark('aiEnabled');
  if (g.topN != null) mark('topN');
  const filters: HuntFilters = { ...EMPTY_FILTERS };
  for (const k of FILTER_KEYS) {
    const value = g.filters[k];
    if (value == null) continue;
    (filters as unknown as Record<string, unknown>)[k] = value;
    if (k !== 'commissionOperator') mark(`filters.${k}`);
  }
  if (filters.minCommissionPct != null && !filters.commissionOperator) filters.commissionOperator = 'GTE';
  const column = sortInColumn(s.draft.provider);
  const sort: HuntSort = column && g.sort && isHuntSort(g.sort) ? g.sort : column ? draft.sort : 'RECOMMENDED';
  if (column && g.sort && isHuntSort(g.sort)) mark('sort');
  const sourceOptions: HuntSourceOptions = { ...EMPTY_SOURCE_OPTIONS, sort: column ? null : caps.defaultSort };
  for (const k of SOURCE_KEYS) {
    const value = g.sourceOptions[k];
    if (value == null || column) continue;
    (sourceOptions as unknown as Record<string, unknown>)[k] = value;
    mark(`sourceOptions.${k}`);
  }
  return {
    ...draft,
    preset: 'CUSTOM',
    name: g.name ?? draft.name,
    categoryId: g.categoryId ?? draft.categoryId,
    keyword: g.keyword ?? draft.keyword,
    sort,
    sourceOptions,
    filters,
    aiEnabled: g.aiEnabled ?? draft.aiEnabled,
    topN: g.topN ?? draft.topN,
    ai: { ...draft.ai, applied: true, hints, dropped: [...s.dropped] },
  };
}

export type FieldErrors = Partial<Record<string, string>>;

/** Passo em que cada campo da API aparece (erro 422 `{ field }` leva de volta a ele). */
export function stepOfField(field: string): number {
  if (['provider', 'aiIntent', 'aiConfigured'].includes(field)) return 0;
  if (['name', 'keyword', 'categoryId', 'sort'].includes(field) || field.startsWith('sourceOptions')) return 1;
  if (field.startsWith('filters.') || ['aiEnabled', 'topN', 'repeatAfterDays'].includes(field)) return 2;
  return 3;
}

const outside = (n: number | null, min: number, max: number, integer = true) =>
  n != null && (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n)));

/** Erros do passo (chave = nome do campo na API). Vazio = pode avançar. */
export function validateStep(step: number, d: HuntWizardDraft, limits: HuntLimits): FieldErrors {
  const e: FieldErrors = {};
  if (step === 0) {
    if (!d.provider) e.provider = offerHunterStrings.wizard.provider.required;
    if (d.ai.intent.trim().length > HUNT_AI_INTENT_MAX) e.aiIntent = v.tooLong(HUNT_AI_INTENT_MAX);
  }
  if (step === 1) {
    const name = d.name.trim();
    if (!name) e.name = v.nameRequired;
    else if (name.length > limits.nameMaxLength) e.name = v.tooLong(limits.nameMaxLength);
    if (d.keyword.trim().length > limits.keywordMaxLength) e.keyword = v.tooLong(limits.keywordMaxLength);
  }
  if (step === 2) {
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
  if (step === 3) {
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
 * deriva a faixa da fonte do filtro de comissão. Operador só vai com percentual (sem % → null). Só vai o que a loja
 * aceita (`capabilities`): filtro local fora dela vai null; Shein manda `sourceOptions` null e a ordem em `sort`.
 */
export function draftToBody(d: HuntWizardDraft, capabilities?: HuntCapabilities | null): CreateHuntInput {
  const provider = d.provider ?? 'SHEIN';
  const caps = capabilities ?? fallbackCapabilities(provider);
  const filters: HuntFilters = {
    ...d.filters,
    commissionOperator: d.filters.minCommissionPct == null ? null : (d.filters.commissionOperator ?? 'GTE'),
    onlyWithExtra: d.filters.onlyWithExtra ? true : null,
  };
  for (const k of FILTER_KEYS) {
    if (k !== 'commissionOperator' && !caps.localFilters.includes(k)) filters[k] = null as never;
  }
  if (filters.minCommissionPct == null) filters.commissionOperator = null;
  const column = sortInColumn(provider);
  const so = d.sourceOptions;
  const sourceOptions: HuntSourceOptions | null = column ? null : {
    sort: so.sort && caps.sorts.includes(so.sort) ? so.sort : caps.defaultSort,
    extraEarningsOnly: hasSourceFilter(caps, 'extraEarningsOnly') && so.extraEarningsOnly ? true : null,
    bestSellersOnly: hasSourceFilter(caps, 'bestSellersOnly') && so.bestSellersOnly ? true : null,
  };
  const aiConfigured = d.ai.applied && d.ai.on;
  return {
    provider,
    name: d.name.trim(),
    sort: column ? d.sort : 'RECOMMENDED',
    categoryId: d.categoryId,
    keyword: d.keyword.trim() || null,
    sourceOptions,
    filters,
    aiEnabled: d.aiEnabled,
    aiConfigured,
    aiIntent: aiConfigured ? d.ai.intent.trim() || null : null,
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
