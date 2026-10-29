import type { StorefrontStatus } from '../enums/StorefrontEnums';

/** Endereço público `<slug>.<domínio>`: vem do `PublicSlugClaim` (sem cópia na página). */
export interface StorefrontAddress {
  domainId: string;
  slug: string;
}

/** Página de Ofertas do tenant (1 por tenant). Cores sempre `#RRGGBB` maiúsculo. */
export interface Storefront {
  id: string;
  tenantId: string;
  title: string;
  subtitle: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  colorPrimary: string;
  colorBackground: string;
  colorCard: string;
  /** Chaves de `storefrontCategories.ts` mostradas na página, na ordem escolhida. */
  categories: string[];
  status: StorefrontStatus;
  /** null só em janela inconsistente (claim ausente); página sem endereço não é servida. */
  address: StorefrontAddress | null;
  createdAt: Date;
  updatedAt: Date;
}
