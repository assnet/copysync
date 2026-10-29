import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { StorefrontOfferStatus } from '../enums/StorefrontEnums';

/** Oferta da página. `position` ordena dentro da aba (status); link não muda após criar. */
export interface StorefrontOffer {
  id: string;
  tenantId: string;
  storefrontId: string;
  status: StorefrontOfferStatus;
  position: number;
  provider: AffiliateProvider;
  /** Link colado pelo tenant. */
  sourceUrl: string;
  /** Link de saída do "Ver oferta". */
  affiliateUrl: string;
  /** false = link colado sem confirmação de que gera comissão ao tenant (selo no painel). */
  attributionVerified: boolean;
  title: string;
  priceCents: number | null;
  originalPriceCents: number | null;
  imageUrl: string | null;
  /** Chave do catálogo, ou null = "Sem categoria". */
  category: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
