import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { OfferStatus } from '../enums/OfferStatus';
import type { OfferAudience } from '../enums/OfferAudience';

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
  /** Código do cupom (até 40 caracteres), ou null. */
  coupon: string | null;
  audience: OfferAudience;
  /** Menciona todos os participantes ao enviar em grupo. */
  mentionAll: boolean;
  status: OfferStatus;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}
