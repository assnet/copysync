import type { HuntLocalFilters, HuntSourceFilters } from '../../hunter/HuntCandidate';

export const HUNT_PRESETS = ['TOP_COMMISSION', 'BEST_SELLERS', 'BIGGEST_DISCOUNT', 'NEW_ARRIVALS', 'CUSTOM'] as const;
export type HuntPreset = (typeof HUNT_PRESETS)[number];

export interface HuntPresetDefinition {
  source: HuntSourceFilters;
  local: HuntLocalFilters;
}

/**
 * Predefinições de 1 clique (HUNT-04). Só mudam filtros; os pesos da pontuação são fixos. A `sort` vai como
 * dica (observado: a fonte a ignora), por isso "Mais vendidos" e "Maior desconto" se garantem pelo filtro local
 * e pela pontuação. A faixa de comissão só reduz o que vem; o mínimo local é a garantia.
 */
const PRESETS: Readonly<Record<HuntPreset, HuntPresetDefinition>> = {
  TOP_COMMISSION: { source: { sort: 'RECOMMENDED', commissionBand: 'ABOVE_15' }, local: { minCommissionPct: 15 } },
  BEST_SELLERS: { source: { sort: 'BEST_SELLING', commissionBand: 'ANY' }, local: { minSales: 100, minRating: 4 } },
  BIGGEST_DISCOUNT: { source: { sort: 'RECOMMENDED', commissionBand: 'ANY' }, local: { minDiscountPct: 40 } },
  NEW_ARRIVALS: { source: { sort: 'NEWEST', commissionBand: 'ANY' }, local: {} },
  CUSTOM: { source: { sort: 'RECOMMENDED', commissionBand: 'ANY' }, local: {} },
};

/** Cópia nova a cada chamada: quem edita o resultado não altera a predefinição. */
export function huntPreset(preset: HuntPreset): HuntPresetDefinition {
  const p = PRESETS[preset];
  return { source: { ...p.source }, local: { ...p.local } };
}
