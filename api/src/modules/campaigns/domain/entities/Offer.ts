import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { OfferStatus } from '../enums/OfferStatus';

/** Oferta gerada a partir de um link de produto. Preços em centavos; `imageUrl` aponta pro media store. */
export interface Offer {
  id: string;
  tenantId: string;
  provider: AffiliateProvider;
  sourceUrl: string;
  productRef: string | null;
  title: string | null;
  priceCents: number | null;
  originalPriceCents: number | null;
  imageUrl: string | null;
  affiliateUrl: string;
  attributionVerified: boolean;
  text: string;
  textEdited: boolean;
  status: OfferStatus;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}
