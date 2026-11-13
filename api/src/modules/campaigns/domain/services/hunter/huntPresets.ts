import type { HuntFilterKey, HuntLocalFilters, HuntSourceFilters } from '../../hunter/HuntCandidate';
import type { HuntCapabilities } from '../../hunter/HuntProvider';

export const HUNT_PRESETS = ['TOP_COMMISSION', 'BEST_SELLERS', 'BIGGEST_DISCOUNT', 'NEW_ARRIVALS', 'CUSTOM'] as const;
export type HuntPreset = (typeof HUNT_PRESETS)[number];

export interface HuntPresetDefinition {
  source: HuntSourceFilters;
  local: HuntLocalFilters;
}

/**
 * Predefinições de 1 clique (HUNT-04). Só mudam filtros; os pesos da pontuação são fixos. A `sort` vai como
 * dica (observado: a fonte a ignora), por isso "Mais vendidos" e "Maior desconto" se garantem pelo filtro local
 * e pela pontuação. Faixa da fonte sempre `ANY` (ela filtra a comissão de recompra); comissão de 1ª compra é
 * só filtro local.
 */
const PRESETS: Readonly<Record<HuntPreset, HuntPresetDefinition>> = {
  TOP_COMMISSION: { source: { sort: 'RECOMMENDED', commissionBand: 'ANY' }, local: { minCommissionPct: 15, commissionOperator: 'GTE' } },
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

/** Predefinição de uma marca: ordenação como texto da marca (Shein = `HuntSort`; ML = `relevance`…). */
export interface HuntProviderPresetDefinition {
  source: { sort: string; commissionBand: HuntSourceFilters['commissionBand'] };
  local: HuntLocalFilters;
}

/**
 * Predefinições que fazem sentido na marca: filtro local fora das capacidades tira a predefinição; ordenação que a
 * marca não tem vira a padrão dela, e a predefinição que só se distinguia pela ordenação (sem filtro) sai
 * (ficaria igual a CUSTOM). Shein = todas, idênticas a `huntPreset`.
 */
export function huntPresetsFor(caps: Pick<HuntCapabilities, 'sorts' | 'defaultSort' | 'localFilters'>): {
  key: HuntPreset; definition: HuntProviderPresetDefinition;
}[] {
  return HUNT_PRESETS.flatMap((key) => {
    const p = huntPreset(key);
    const localKeys = (Object.keys(p.local) as (keyof HuntLocalFilters)[]).filter((k) => k !== 'commissionOperator');
    if (localKeys.some((k) => !caps.localFilters.includes(k as HuntFilterKey))) return [];
    const sortOk = caps.sorts.includes(p.source.sort);
    if (!sortOk && key !== 'CUSTOM' && localKeys.length === 0) return [];
    return [{ key, definition: { source: { sort: sortOk ? p.source.sort : caps.defaultSort, commissionBand: p.source.commissionBand }, local: p.local } }];
  });
}
