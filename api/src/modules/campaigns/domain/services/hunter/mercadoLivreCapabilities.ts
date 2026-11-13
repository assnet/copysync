// Capacidades do Caçador no Mercado Livre (hub de afiliados, observado 2026-11-13; docs/extensao-ml-endpoints.md).
import type { HuntCapabilities } from '../../hunter/HuntProvider';

/** Ordenações aceitas pelo hub (`sort` + `available_sorts` da resposta). */
export const MERCADO_LIVRE_HUNT_SORTS = ['relevance', 'lowest_price', 'highest_price'] as const;
export type MercadoLivreHuntSort = (typeof MERCADO_LIVRE_HUNT_SORTS)[number];

export const MERCADO_LIVRE_PRODUCT_ID = /^MLB\d{5,15}$/;

export const MERCADO_LIVRE_HUNT_CAPABILITIES: HuntCapabilities = Object.freeze<HuntCapabilities>({
  provider: 'MERCADO_LIVRE',
  sorts: MERCADO_LIVRE_HUNT_SORTS,
  defaultSort: 'relevance',
  sourceFilters: ['keyword', 'category', 'extraEarningsOnly', 'bestSellersOnly', 'sort'],
  // Hub não traz nº de avaliações nem fim de campanha: `minReviews`/`endsWithinDays` ficam de fora
  localFilters: [
    'minPriceCents',
    'maxPriceCents',
    'minDiscountPct',
    'minCommissionPct',
    'minCommissionCents',
    'minRating',
    'minSales',
    'onlyWithExtra',
  ],
  commissionModel: 'SINGLE_WITH_EXTRA_FLAG',
  imageHosts: ['mlstatic.com'],
  productIdPattern: MERCADO_LIVRE_PRODUCT_ID,
  // Hub não traz posição no ranking: `rank` fica fora da nota
  sourceRank: false,
});
