// Contratos multimarca do Caçador de Ofertas (spec `.specs/features/offer-hunter-multi/`, design §3b).
// Marca = subconjunto de `AffiliateProvider` (credencial, aceite e Resolve já usam esse tipo). Puro: sem infra.
import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { HuntCandidate, HuntFilterKey } from './HuntCandidate';

export const HUNT_PROVIDERS = ['SHEIN', 'MERCADO_LIVRE'] as const satisfies readonly AffiliateProvider[];
export type HuntProvider = (typeof HUNT_PROVIDERS)[number];

export function isHuntProvider(value: unknown): value is HuntProvider {
  return typeof value === 'string' && (HUNT_PROVIDERS as readonly string[]).includes(value);
}

/** Sessão já decifrada, por marca. Nunca sai em log, erro, resposta ou prompt. */
export type HuntSourceSession =
  | { provider: 'SHEIN'; token: string; memberId: string }
  | { provider: 'MERCADO_LIVRE'; cookies: Record<string, string> };

/** Categoria da fonte. Toda porta devolve uma entrada `categoryId: null` ("Todas"), sintetizada se a fonte não tiver. */
export interface HuntSourceCategory {
  categoryId: string | null;
  name: string;
}

/** Filtros da fonte (o que a loja filtra do lado dela). Só os que a marca declara em `sourceFilters` são aceitos. */
export interface HuntSourceOptions {
  /** Ordenação da fonte; valores válidos em `HuntCapabilities.sorts`. */
  sort?: string | null;
  /** ML: só produtos com "ganhos extras". */
  extraEarningsOnly?: boolean | null;
  /** ML: só "mais vendidos". */
  bestSellersOnly?: boolean | null;
}

export interface HuntSourceQuery {
  /** 1-based; a porta traduz para offset/página da fonte. */
  page: number;
  category: HuntSourceCategory | null;
  /** ≤ 60 caracteres, sem controle; null = sem busca por palavra. */
  keyword: string | null;
  options: HuntSourceOptions;
}

export interface HuntSourcePage {
  items: HuntCandidate[];
  hasNextPage: boolean;
}

/**
 * Porta da fonte de catálogo de uma marca. Erros como `Affiliate*Error` (sessão recusada = só login/401; WAF/403 sem
 * redirect = indisponível). Formato inesperado = `AffiliateApiUnavailableError`, nunca lista vazia silenciosa.
 */
export interface IHuntCatalogSource {
  readonly provider: HuntProvider;
  listCategories(session: HuntSourceSession): Promise<HuntSourceCategory[]>;
  fetchPage(session: HuntSourceSession, query: HuntSourceQuery): Promise<HuntSourcePage>;
}

export type HuntSourceFilterKey = keyof HuntSourceOptions | 'keyword' | 'category';

/** Como a comissão da marca é lida: Shein 1ª compra × recompra; ML percentual do hub (já inclui ganhos extras). */
export type HuntCommissionModel = 'NEW_RETURNING' | 'SINGLE_WITH_EXTRA_FLAG';

/** Capacidades de uma marca: o painel e a validação só oferecem/aceitam o que estiver aqui. */
export interface HuntCapabilities {
  provider: HuntProvider;
  sorts: readonly string[];
  defaultSort: string;
  sourceFilters: readonly HuntSourceFilterKey[];
  localFilters: readonly HuntFilterKey[];
  commissionModel: HuntCommissionModel;
  /** Hosts aceitos para foto (https), ex.: `ltwebstatic.com`, `mlstatic.com` (e subdomínios). */
  imageHosts: readonly string[];
  /** Id do produto na marca (validação antes de montar URL). */
  productIdPattern: RegExp;
  /** A fonte traz posição no ranking (`rank`); `false` = fator `rank` fora da nota. Ausente = traz (Shein). */
  sourceRank?: boolean;
}
