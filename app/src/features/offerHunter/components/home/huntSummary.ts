import { offerHunterStrings } from '../../strings';
import { formatCents } from '../../format';
import type { Hunt, HuntFilters, HuntOptions, HuntPreset } from '../../types';

const t = offerHunterStrings;

/**
 * Predefinição que a caçada segue: a primeira (fora `CUSTOM`) com a mesma ordem e os mesmos filtros locais
 * (a faixa da fonte não conta: é legado, sempre ANY) (os não definidos pela predefinição precisam estar vazios). Senão `CUSTOM`.
 */
export function matchPreset(hunt: Hunt, presets: HuntOptions['presets']): HuntPreset {
  for (const p of presets) {
    if (p.key === 'CUSTOM') continue;
    const { source, local } = p.definition;
    if (source.sort !== hunt.sort) continue;
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
  const push = (key: string, label: string, tooltip: string) => out.push({ key, label, tooltip });
  if (options) {
    const preset = t.presets[matchPreset(hunt, options.presets)];
    push('preset', preset.label, preset.hint);
  }
  if (hunt.categoryId) {
    const cat = options?.categories.find((x) => x.categoryId === hunt.categoryId);
    push('category', cat?.name ?? t.home.categoryUnknown, tip.category);
  }
  const min = formatCents(f.minPriceCents);
  const max = formatCents(f.maxPriceCents);
  if (min || max) push('price', t.home.priceRange(min, max), tip.price);
  if (f.minDiscountPct != null) push('discount', c.discount(f.minDiscountPct), tip.minDiscount);
  if (f.minCommissionPct != null) {
    const op = t.wizard.refine.commissionOperators[f.commissionOperator ?? 'GTE'];
    push('commission', c.commission(op.symbol, f.minCommissionPct), c.commissionTip(op.label, f.minCommissionPct));
  }
  const commissionValue = formatCents(f.minCommissionCents);
  if (commissionValue) push('commissionValue', c.commissionValue(commissionValue), tip.minCommissionValue);
  if (f.minRating != null) push('rating', c.rating(f.minRating), tip.minRating);
  if (f.minSales != null) push('sales', c.sales(f.minSales), tip.minSales);
  if (f.minReviews != null) push('reviews', c.reviews(f.minReviews), tip.minReviews);
  if (f.onlyWithExtra === true) push('onlyWithExtra', c.onlyWithExtra, t.wizard.refine.onlyWithExtraHint);
  if (f.endsWithinDays != null) push('endsWithin', c.endsWithin(f.endsWithinDays), tip.endsWithin);
  if (hunt.keyword) push('keyword', t.home.keyword(hunt.keyword), tip.keyword);
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
