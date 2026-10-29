import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { StorefrontOffer } from '../entities/StorefrontOffer';
import type { StorefrontOfferStatus } from '../enums/StorefrontEnums';

export interface CreateStorefrontOfferInput {
  tenantId: string;
  storefrontId: string;
  /** Sempre DRAFT na extração; fica explícito para o repo não decidir regra. */
  status: StorefrontOfferStatus;
  position: number;
  provider: AffiliateProvider;
  sourceUrl: string;
  affiliateUrl: string;
  /** false = link colado sem confirmação de comissão (Shopee sem credencial, design.md §4.3). */
  attributionVerified: boolean;
  title: string;
  priceCents: number | null;
  originalPriceCents: number | null;
  imageUrl: string | null;
  category: string | null;
}

/** Campos editáveis pelo tenant (link não muda: apague e cole de novo). */
export interface UpdateStorefrontOfferInput {
  title?: string;
  priceCents?: number | null;
  originalPriceCents?: number | null;
  category?: string | null;
}

/** Troca de aba: novo status, posição no fim da aba e `publishedAt` (null ao despublicar). */
export interface SetStorefrontOfferStatusInput {
  status: StorefrontOfferStatus;
  position: number;
  publishedAt: Date | null;
}

export interface StorefrontOfferCounts {
  total: number;
  published: number;
}

/** Ofertas da página. Toda operação recebe `tenantId` e filtra por ele no where. */
export interface IStorefrontOfferRepository {
  /** Todas as ofertas da página, por status e `position` crescente. */
  listByStorefront(tenantId: string, storefrontId: string): Promise<StorefrontOffer[]>;
  /** Só as publicadas, na ordem (página pública e preview). */
  listPublished(tenantId: string, storefrontId: string): Promise<StorefrontOffer[]>;
  findById(tenantId: string, id: string): Promise<StorefrontOffer | null>;
  /** Total (limite 200) e publicadas (limite 60) numa ida ao banco. */
  countByStorefront(tenantId: string, storefrontId: string): Promise<StorefrontOfferCounts>;
  /** Maior `position` da aba, ou null se vazia (nova oferta vai para o fim). */
  maxPosition(tenantId: string, storefrontId: string, status: StorefrontOfferStatus): Promise<number | null>;
  /** Ids da aba na ordem atual (validação do reorder: conjunto exato). */
  listIdsByStatus(tenantId: string, storefrontId: string, status: StorefrontOfferStatus): Promise<string[]>;
  create(input: CreateStorefrontOfferInput): Promise<StorefrontOffer>;
  /** `StorefrontNotFoundError` se a oferta não for do tenant. */
  update(tenantId: string, id: string, input: UpdateStorefrontOfferInput): Promise<StorefrontOffer>;
  setStatus(tenantId: string, id: string, input: SetStorefrontOfferStatusInput): Promise<StorefrontOffer>;
  /** Em lote e atômico: `orderedIds[i]` recebe `position = i`. Ids validados antes pelo use case. */
  setPositions(tenantId: string, storefrontId: string, orderedIds: readonly string[]): Promise<void>;
  delete(tenantId: string, id: string): Promise<void>;
  /** Categoria removida da página: ofertas fora de `keep` viram "Sem categoria". Devolve quantas mudaram. */
  clearCategoriesNotIn(tenantId: string, storefrontId: string, keep: readonly string[]): Promise<number>;
}
