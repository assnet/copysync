import type { OfferDispatchStatus } from '../enums/OfferDispatchStatus';

/**
 * Envio de uma oferta para uma conversa. `notBefore` = cadência; `claimedAt` + `claimToken` =
 * posse pelo worker (token novo a cada claim).
 */
export interface OfferDispatch {
  id: string;
  tenantId: string;
  offerId: string;
  conversationId: string;
  status: OfferDispatchStatus;
  notBefore: Date;
  claimedAt: Date | null;
  claimToken: string | null;
  chatMessageId: string | null;
  failureReason: string | null;
  updatedAt: Date;
}
