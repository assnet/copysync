// Capacidades da Shein no Caçador de Ofertas (design §3b). Puro: constante de domínio, nunca do banco.
import { HUNT_SORTS, type HuntFilterKey } from '../../hunter/HuntCandidate';
import type { HuntCapabilities } from '../../hunter/HuntProvider';

/** Todos os filtros locais existentes hoje (a Shein traz todos os dados). */
const ALL_LOCAL_FILTERS: readonly HuntFilterKey[] = [
  'minPriceCents', 'maxPriceCents', 'minDiscountPct', 'minCommissionPct', 'minCommissionCents', 'minRating',
  'minSales', 'minReviews', 'onlyWithExtra', 'endsWithinDays',
];

/**
 * Shein: ordenação em `offer_hunts.sort` (códigos da fonte, nomes `HUNT_SORTS`; a fonte trata como dica), busca
 * por palavra e categoria. Comissão 1ª compra × recompra. Foto só `*.ltwebstatic.com`. Id = goodsId (4–12 dígitos).
 */
export const SHEIN_HUNT_CAPABILITIES: HuntCapabilities = Object.freeze<HuntCapabilities>({
  provider: 'SHEIN',
  sorts: HUNT_SORTS,
  defaultSort: 'RECOMMENDED',
  sourceFilters: ['keyword', 'category', 'sort'],
  localFilters: ALL_LOCAL_FILTERS,
  commissionModel: 'NEW_RETURNING',
  imageHosts: ['ltwebstatic.com'],
  productIdPattern: /^\d{4,12}$/,
});
