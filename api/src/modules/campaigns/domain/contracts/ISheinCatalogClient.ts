// Porta do catálogo de comissão do painel de afiliados da Shein (Caçador de Ofertas). Separada do
// ISheinAffiliateClient, que continua só com o link de um produto. Erros saem como Affiliate*Error, sem token.
import type { HuntCandidate, HuntCommissionBand, HuntSort } from '../hunter/HuntCandidate';
import type { SheinSession } from './ISheinAffiliateClient';

export type { SheinSession };

/** Item de `info.materialInfoList`. O 1º é "All" com `categoryId` null. */
export interface SheinCatalogCategory {
  categoryId: string | null;
  name: string;
  did: number;
}

export interface SheinCatalogQuery {
  /** 1-based */
  page: number;
  /** `did` (número) de `listCategories` ou da faixa (`resolveCommissionBand`, que substitui o da categoria). */
  did: number;
  /** Vinda de `listCategories` (`name` vai no corpo); null = "All". */
  category: { categoryId: string; name: string } | null;
  /** Dica: a fonte não respeita (observado). */
  sort: HuntSort;
}

export interface SheinCatalogSearchQuery extends SheinCatalogQuery {
  /** ≤ 60 caracteres, sem caractere de controle; inválida → OfferInvalidInputError antes da rede. */
  keyword: string;
}

export interface SheinCatalogPage {
  items: HuntCandidate[];
  hasNextPage: boolean;
  total: number;
}

export interface ISheinCatalogClient {
  listCategories(session: SheinSession): Promise<SheinCatalogCategory[]>;
  /** Faixa de comissão → `info.materialInfoList[0].did`. */
  resolveCommissionBand(session: SheinSession, band: HuntCommissionBand): Promise<number>;
  /** `goodsList: null` (sintoma de header faltando) lança AffiliateApiUnavailableError; `[]` é vazio legítimo. */
  list(session: SheinSession, query: SheinCatalogQuery): Promise<SheinCatalogPage>;
  search(session: SheinSession, query: SheinCatalogSearchQuery): Promise<SheinCatalogPage>;
}
