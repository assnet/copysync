import { AppError } from '../AppError';

// ── Offer generator errors ───────────────────────────────────────────────────

/** Host fora da allowlist, esquema ≠ https, porta, userinfo ou IP. Nenhuma requisição é feita. */
export class OfferUrlUnsupportedError extends AppError {
  constructor(reason = 'Unsupported product URL') {
    super('OFFER_URL_UNSUPPORTED', reason, 422);
  }
}

export class OfferProductNotFoundError extends AppError {
  constructor(provider: string) {
    super('OFFER_PRODUCT_NOT_FOUND', `Product not found on ${provider}`, 404, { provider });
  }
}

export class OfferNotFoundError extends AppError {
  constructor(offerId: string) {
    super('OFFER_NOT_FOUND', `Offer not found: ${offerId}`, 404);
  }
}

export class OfferAlreadySentError extends AppError {
  constructor(offerId: string) {
    super('OFFER_ALREADY_SENT', `Offer already sent or sending: ${offerId}`, 409);
  }
}

export class OfferNoDestinationsError extends AppError {
  constructor() {
    super('OFFER_NO_DESTINATIONS', 'No offer destinations selected', 422);
  }
}

// ── Marketplace affiliate API errors (nunca carregam corpo, header ou segredo) ──

/** Afiliado sem acesso liberado à API do marketplace (Shopee 10035). */
export class AffiliateApiAccessDeniedError extends AppError {
  constructor(provider: string) {
    super('AFFILIATE_API_ACCESS_DENIED', `Affiliate API access not enabled on ${provider}`, 422, { provider });
  }
}

/** Credencial recusada pelo marketplace (assinatura/AppID inválidos). */
export class AffiliateCredentialRejectedError extends AppError {
  constructor(provider: string) {
    super('AFFILIATE_CREDENTIAL_REJECTED', `Affiliate credential rejected by ${provider}`, 422, { provider });
  }
}

export class AffiliateApiRateLimitedError extends AppError {
  constructor(provider: string) {
    super('AFFILIATE_API_RATE_LIMITED', `Affiliate API rate limit on ${provider}`, 429, { provider });
  }
}

/** Timeout, 5xx ou resposta ilegível. */
export class AffiliateApiUnavailableError extends AppError {
  constructor(provider: string) {
    super('AFFILIATE_API_UNAVAILABLE', `Affiliate API unavailable: ${provider}`, 503, { provider });
  }
}

/** Entrada inválida na edição/destinos (422). `field` aponta o campo; nunca carrega o valor. */
export class OfferInvalidInputError extends AppError {
  constructor(reason: string, field?: string) {
    super('OFFER_INVALID_INPUT', reason, 422, field ? { field } : undefined);
  }
}

/** Destino do envio indisponível (conversa apagada ou sem sessão): o envio é pulado, não falha. */
export class OfferDestinationUnavailableError extends AppError {
  constructor(conversationId: string) {
    super('OFFER_DESTINATION_UNAVAILABLE', `Offer destination unavailable: ${conversationId}`, 409);
  }
}
