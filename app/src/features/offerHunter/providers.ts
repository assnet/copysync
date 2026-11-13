import { AFFILIATE_PROVIDERS } from '@/features/settings/affiliateProviders';
import { firstClosedGate } from './hooks/useHuntInfo';
import type {
  HuntCapabilities, HuntLocalFilterKey, HuntOptions, HuntProvider, HuntProviderState, HuntSourceFilterKey, HuntSourceOptions,
} from './types';
import { HUNT_PROVIDERS, HUNT_SORTS, ML_HUNT_SORTS } from './types';

/** Lojas que o caçador mostra, na ordem da grade (Shopee/Amazon só entram quando tiverem fonte). */
export { HUNT_PROVIDERS };

export interface HuntProviderBrand {
  provider: HuntProvider;
  /** Do catálogo de afiliados: só logo, nome e cor (os ícones de `highlights` não entram aqui). */
  name: string;
  logo: string;
  brandColor: string;
}

/** Logo/nome/cor da loja a partir de `AFFILIATE_PROVIDERS` (sem SVG novo). */
export function huntProviderBrand(provider: HuntProvider): HuntProviderBrand {
  const spec = AFFILIATE_PROVIDERS.find((p) => p.provider === provider);
  return { provider, name: spec?.name ?? provider, logo: spec?.logo ?? '', brandColor: spec?.brandColor ?? 'transparent' };
}

/** Marca de um registro; ausente (dado antigo) = SHEIN. */
export const providerOf = (x: { provider?: HuntProvider | null } | null | undefined): HuntProvider => x?.provider ?? 'SHEIN';

/** Shein guarda a ordenação na coluna `sort`; as demais em `sourceOptions.sort`. */
export const sortInColumn = (provider: HuntProvider) => provider === 'SHEIN';

const ALL_LOCAL: HuntLocalFilterKey[] = [
  'minPriceCents', 'maxPriceCents', 'minDiscountPct', 'minCommissionPct', 'minCommissionCents', 'minRating',
  'minSales', 'minReviews', 'onlyWithExtra', 'endsWithinDays',
];

/** Espelho das capacidades da API, só para quando a resposta não trouxer `capabilities` (a resposta manda). */
const FALLBACK_CAPABILITIES: Record<HuntProvider, HuntCapabilities> = {
  SHEIN: {
    provider: 'SHEIN', sorts: [...HUNT_SORTS], defaultSort: 'RECOMMENDED', sourceFilters: ['keyword', 'category', 'sort'],
    localFilters: ALL_LOCAL, commissionModel: 'NEW_RETURNING',
  },
  MERCADO_LIVRE: {
    provider: 'MERCADO_LIVRE', sorts: [...ML_HUNT_SORTS], defaultSort: 'relevance',
    sourceFilters: ['keyword', 'category', 'extraEarningsOnly', 'bestSellersOnly', 'sort'],
    localFilters: ALL_LOCAL.filter((k) => k !== 'minReviews' && k !== 'endsWithinDays'),
    commissionModel: 'SINGLE_WITH_EXTRA_FLAG',
  },
};

export function capabilitiesOf(options: Pick<HuntOptions, 'capabilities'> & { provider?: HuntProvider } | null | undefined, provider?: HuntProvider): HuntCapabilities {
  return options?.capabilities ?? FALLBACK_CAPABILITIES[provider ?? options?.provider ?? 'SHEIN'];
}

export const fallbackCapabilities = (provider: HuntProvider) => FALLBACK_CAPABILITIES[provider];

export const hasLocalFilter = (caps: HuntCapabilities, key: HuntLocalFilterKey) => caps.localFilters.includes(key);
export const hasSourceFilter = (caps: HuntCapabilities, key: HuntSourceFilterKey) => caps.sourceFilters.includes(key);

/**
 * "Só com comissão extra" (filtro local) só aparece quando a loja não filtra isso na fonte: no ML o "Só com
 * ganhos extras" da fonte faz o mesmo e mostrar os dois confundiria.
 */
export const showsLocalExtraFilter = (caps: HuntCapabilities) =>
  hasLocalFilter(caps, 'onlyWithExtra') && !hasSourceFilter(caps, 'extraEarningsOnly');

export const EMPTY_SOURCE_OPTIONS: HuntSourceOptions = { sort: null, extraEarningsOnly: null, bestSellersOnly: null };

/** Estado da loja no passo 0 (ordem: plano → conta → aviso). */
export type HuntProviderStatus = 'READY' | 'NO_PLAN' | 'NO_ACCOUNT' | 'ACCOUNT_REJECTED' | 'NO_RISK';

export function huntProviderStatus(state: HuntProviderState | null | undefined): HuntProviderStatus {
  if (!state) return 'NO_PLAN';
  const g = state.gates;
  if (!g.plan || !g.hunterEntitlement) return 'NO_PLAN';
  if (state.credentialState === 'REJECTED') return 'ACCOUNT_REJECTED';
  if (!g.credential) return 'NO_ACCOUNT';
  if (!g.riskAccepted) return 'NO_RISK';
  return 'READY';
}

/**
 * Loja que a tela inicial usa para o painel de portões: a 1ª pronta para ligar; senão a 1ª com plano; senão SHEIN.
 */
export function pickHomeProvider(items: HuntProviderState[] | null | undefined): HuntProvider {
  const list = items ?? [];
  return list.find((s) => firstClosedGate(s.gates) === null)?.provider
    ?? list.find((s) => s.gates.plan && s.gates.hunterEntitlement)?.provider
    ?? 'SHEIN';
}
