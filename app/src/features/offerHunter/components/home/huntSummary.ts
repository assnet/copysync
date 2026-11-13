import { commissionCopy, offerHunterStrings } from '../../strings';
import { formatCents } from '../../format';
import type { Hunt, HuntFilters, HuntOptions, HuntPreset, MlHuntSort } from '../../types';
import { fallbackCapabilities, providerOf, sortInColumn } from '../../providers';

const t = offerHunterStrings;

/**
 * Predefinição que a caçada segue: a primeira (fora `CUSTOM`) com a mesma ordem e os mesmos filtros locais
 * (a faixa da fonte não conta: é legado, sempre ANY) (os não definidos pela predefinição precisam estar vazios). Senão `CUSTOM`.
 */
export function matchPreset(hunt: Hunt, presets: HuntOptions['presets']): HuntPreset {
  const provider = providerOf(hunt);
  const sort = sortInColumn(provider) ? hunt.sort : (hunt.sourceOptions?.sort ?? fallbackCapabilities(provider).defaultSort);
  // Filtros da fonte ligados (ganhos extras, mais vendidos) não fazem parte de nenhuma predefinição
  if (hunt.sourceOptions?.extraEarningsOnly || hunt.sourceOptions?.bestSellersOnly) return 'CUSTOM';
  for (const p of presets) {
    if (p.key === 'CUSTOM') continue;
    const { source, local } = p.definition;
    if (source.sort !== sort) continue;
    const keys = Object.keys(hunt.filters) as (keyof HuntFilters)[];
    const same = keys.every((k) => (local[k] ?? null) === (hunt.filters[k] ?? null));
    if (same) return p.key;
  }
  return 'CUSTOM';
}

export interface HuntSummaryChip {
  /** Estável por tipo de filtro (chave do React e dos testes). */
  key: string;
  label: string;
  /** Explicação curta (Tooltip do chip). */
  tooltip: string;
}

/**
 * Chips de resumo com todo filtro ligado: predefinição, categoria, preço, desconto, comissão (% com operador e
 * R$), nota, vendas, avaliações, só com extra, prazo e palavra-chave. A faixa da fonte não aparece (é derivada
 * da comissão no servidor).
 */
export function huntSummaryChips(hunt: Hunt, options: HuntOptions | null): HuntSummaryChip[] {
  const out: HuntSummaryChip[] = [];
  const f = hunt.filters;
  const tip = t.wizard.tips;
  const c = t.home.chips;
  const provider = providerOf(hunt);
  const cc = commissionCopy(provider);
  const push = (key: string, label: string, tooltip: string) => out.push({ key, label, tooltip });
  // Opções de outra loja não servem para nomear predefinição/categoria desta caçada
  const opts = options && providerOf(options) === provider ? options : null;
  if (opts) {
    const preset = t.presets[matchPreset(hunt, opts.presets)];
    push('preset', preset.label, preset.hint);
  }
  if (hunt.categoryId) {
    const cat = opts?.categories.find((x) => x.categoryId === hunt.categoryId);
    push('category', cat?.name ?? t.home.categoryUnknown, tip.category);
  }
  const so = hunt.sourceOptions;
  if (!sortInColumn(provider) && so) {
    if (so.sort && so.sort !== fallbackCapabilities(provider).defaultSort) {
      push('sourceSort', c.sourceSort(t.mlSorts[so.sort as MlHuntSort] ?? so.sort), t.wizard.what.sourceSortTip);
    }
    if (so.extraEarningsOnly) push('extraEarningsOnly', c.extraEarningsOnly, t.wizard.what.extraEarningsOnlyHint);
    if (so.bestSellersOnly) push('bestSellersOnly', c.bestSellersOnly, t.wizard.what.bestSellersOnlyHint);
  }
  const min = formatCents(f.minPriceCents);
  const max = formatCents(f.maxPriceCents);
  if (min || max) push('price', t.home.priceRange(min, max), tip.price);
  if (f.minDiscountPct != null) push('discount', c.discount(f.minDiscountPct), tip.minDiscount);
  if (f.minCommissionPct != null) {
    const op = t.wizard.refine.commissionOperators[f.commissionOperator ?? 'GTE'];
    push('commission', c.commission(op.symbol, f.minCommissionPct, cc.chip), c.commissionTip(op.label, f.minCommissionPct, cc.chipTip));
  }
  const commissionValue = formatCents(f.minCommissionCents);
  if (commissionValue) push('commissionValue', c.commissionValue(commissionValue, cc.chip), cc.minValueTip);
  if (f.minRating != null) push('rating', c.rating(f.minRating), tip.minRating);
  if (f.minSales != null) push('sales', c.sales(f.minSales), tip.minSales);
  if (f.minReviews != null) push('reviews', c.reviews(f.minReviews), tip.minReviews);
  if (f.onlyWithExtra === true) push('onlyWithExtra', c.onlyWithExtra, t.wizard.refine.onlyWithExtraHint);
  if (f.endsWithinDays != null) push('endsWithin', c.endsWithin(f.endsWithinDays), tip.endsWithin);
  if (hunt.keyword) push('keyword', t.home.keyword(hunt.keyword), tip.keyword);
  if (hunt.aiConfigured) push('aiConfigured', c.aiConfigured, c.aiConfiguredTip);
  return out;
}

/** "Próxima busca em 25 minutos" relativo a `nowMs` (sempre `serverNow()`). Pausada/sem horário → sem próxima. */
export function nextRunLabel(hunt: Hunt, nowMs: number): string {
  if (hunt.status !== 'ACTIVE' || !hunt.nextRunAt) return t.list.nextRunNone;
  const at = Date.parse(hunt.nextRunAt);
  if (!Number.isFinite(at)) return t.list.nextRunNone;
  const diff = at - nowMs;
  if (diff < 60_000) return t.home.nextRunOverdue;
  return t.list.nextRunIn(t.home.relative(diff));
}

export function lastRunLabel(hunt: Hunt, nowMs: number): string {
  if (!hunt.lastRunAt) return t.list.lastRunNever;
  const at = Date.parse(hunt.lastRunAt);
  return Number.isFinite(at) ? t.home.lastRunAt(t.home.relative(at - nowMs)) : t.list.lastRunNever;
}

/** Pausa aplicada pelo sistema (não pelo usuário): alerta no cartão. */
export const isAutoPaused = (hunt: Hunt) => hunt.status === 'PAUSED' && hunt.pauseReason !== null && hunt.pauseReason !== 'USER';
