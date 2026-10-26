import type { AffiliateProvider } from '../../../integrations/domain/enums/AffiliateProvider';
import type { Offer } from '../../domain/entities/Offer';
import type { OfferDispatch } from '../../domain/entities/OfferDispatch';
import type { OfferDispatchStatus } from '../../domain/enums/OfferDispatchStatus';
import type { OfferStatus } from '../../domain/enums/OfferStatus';
import type { OfferAudience } from '../../domain/enums/OfferAudience';

export interface OfferDispatchDTO {
  id: string;
  conversationId: string;
  status: OfferDispatchStatus;
  notBefore: string;
  chatMessageId: string | null;
  failureReason: string | null;
  updatedAt: string;
}

/** Saída HTTP da oferta. Nunca carrega credencial; datas ISO. */
export interface OfferDTO {
  id: string;
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
  coupon: string | null;
  audience: OfferAudience;
  mentionAll: boolean;
  status: OfferStatus;
  createdAt: string;
  updatedAt: string;
  dispatches?: OfferDispatchDTO[];
}

export function toOfferDispatchDto(d: OfferDispatch): OfferDispatchDTO {
  return {
    id: d.id,
    conversationId: d.conversationId,
    status: d.status,
    notBefore: d.notBefore.toISOString(),
    chatMessageId: d.chatMessageId,
    failureReason: d.failureReason,
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toOfferDto(offer: Offer, dispatches?: OfferDispatch[]): OfferDTO {
  const dto: OfferDTO = {
    id: offer.id,
    provider: offer.provider,
    sourceUrl: offer.sourceUrl,
    productRef: offer.productRef,
    title: offer.title,
    priceCents: offer.priceCents,
    originalPriceCents: offer.originalPriceCents,
    imageUrl: offer.imageUrl,
    affiliateUrl: offer.affiliateUrl,
    attributionVerified: offer.attributionVerified,
    text: offer.text,
    textEdited: offer.textEdited,
    coupon: offer.coupon,
    audience: offer.audience,
    mentionAll: offer.mentionAll,
    status: offer.status,
    createdAt: offer.createdAt.toISOString(),
    updatedAt: offer.updatedAt.toISOString(),
  };
  if (dispatches) dto.dispatches = dispatches.map(toOfferDispatchDto);
  return dto;
}
