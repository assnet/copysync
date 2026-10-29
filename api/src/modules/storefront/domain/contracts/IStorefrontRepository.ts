import type { Storefront } from '../entities/Storefront';
import type { StorefrontStatus } from '../enums/StorefrontEnums';

export interface CreateStorefrontInput {
  tenantId: string;
  title: string;
  subtitle: string | null;
  colorPrimary: string;
  colorBackground: string;
  colorCard: string;
  categories: string[];
}

/** Campos editáveis; ausente = não muda. Endereço muda pelo `IPublicSlugRegistry`, não aqui. */
export interface UpdateStorefrontInput {
  title?: string;
  subtitle?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  colorPrimary?: string;
  colorBackground?: string;
  colorCard?: string;
  categories?: string[];
}

/** Leitura da rota pública: página resolvida pelo endereço + se o tenant pode servir. */
export interface PublicStorefront {
  storefront: Storefront;
  /** false quando o tenant está suspenso/cancelado. */
  tenantActive: boolean;
}

/** Página do tenant (1 por tenant). Toda operação tenant-aware recebe `tenantId`. */
export interface IStorefrontRepository {
  findByTenant(tenantId: string): Promise<Storefront | null>;
  create(input: CreateStorefrontInput): Promise<Storefront>;
  /** `StorefrontNotFoundError` se o tenant não tem página. */
  update(tenantId: string, input: UpdateStorefrontInput): Promise<Storefront>;
  /** Plano → status (`ApplyPlanToStorefrontUseCase`). Devolve o status gravado, ou null sem página. */
  setStatus(tenantId: string, status: StorefrontStatus): Promise<StorefrontStatus | null>;
  delete(tenantId: string): Promise<void>;
  /** Rota pública: resolve pelo claim `(domainId, slug)` de kind STOREFRONT. Sem tenant (o Host decide). */
  findPublicByAddress(domainId: string, slug: string): Promise<PublicStorefront | null>;
}
