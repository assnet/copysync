import type { OfferDispatchStatus } from '../enums/OfferDispatchStatus';

/**
 * Envio de uma oferta para uma conversa. Envios da mesma sessão saem em série (faixa, ver
 * docs/fila-de-envio.md). `notBefore` = cadência; `claimedAt` + `claimToken` =
 * posse pelo worker (token novo a cada claim).
 */
export interface OfferDispatch {
  id: string;
  tenantId: string;
  offerId: string;
  conversationId: string;
  /** Faixa de envio (sessão da conversa). null só em envio antigo sem sessão. */
  sessionId: string | null;
  /** Intervalo mínimo (s) desde o início do último envio da mesma sessão. */
  gapSeconds: number;
  status: OfferDispatchStatus;
  notBefore: Date;
  claimedAt: Date | null;
  claimToken: string | null;
  chatMessageId: string | null;
  failureReason: string | null;
  updatedAt: Date;
}
