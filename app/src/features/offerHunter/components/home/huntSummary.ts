import { offerHunterStrings } from '../../strings';
import { formatCents } from '../../format';
import type { Hunt, HuntFilters, HuntOptions, HuntPreset } from '../../types';

const t = offerHunterStrings;

/**
 * Predefinição que a caçada segue: a primeira (fora `CUSTOM`) com a mesma ordem/faixa e os mesmos
 * filtros locais (os não definidos pela predefinição precisam estar vazios). Senão `CUSTOM`.
 */
export function matchPreset(hunt: Hunt, presets: HuntOptions['presets']): HuntPreset {
  for (const p of presets) {
    if (p.key === 'CUSTOM') continue;
    const { source, local } = p.definition;
    if (source.sort !== hunt.sort || source.commissionBand !== (hunt.commissionBand ?? 'ANY')) continue;
    const keys = Object.keys(hunt.filters) as (keyof HuntFilters)[];
    const same = keys.every((k) => (local[k] ?? null) === (hunt.filters[k] ?? null));
    if (same) return p.key;
  }
  return 'CUSTOM';
}

/** Chips de resumo: predefinição, categoria, faixa de comissão, preço e palavra-chave. */
export function huntSummaryChips(hunt: Hunt, options: HuntOptions | null): string[] {
  const out: string[] = [];
  if (options) out.push(t.presets[matchPreset(hunt, options.presets)].label);
  if (hunt.categoryId) {
    const cat = options?.categories.find((c) => c.categoryId === hunt.categoryId);
    out.push(cat?.name ?? t.home.categoryUnknown);
  }
  if (hunt.commissionBand && hunt.commissionBand !== 'ANY') out.push(t.commissionBands[hunt.commissionBand]);
  const min = formatCents(hunt.filters.minPriceCents);
  const max = formatCents(hunt.filters.maxPriceCents);
  if (min || max) out.push(t.home.priceRange(min, max));
  if (hunt.keyword) out.push(t.home.keyword(hunt.keyword));
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
