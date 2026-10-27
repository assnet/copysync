import { AppError } from '../AppError';
import { PlanFeatureUnavailableError } from './PlanErrors';

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

/** Oferta mudou entre a leitura e a gravação (edição concorrente): nada foi sobrescrito. */
export class OfferChangedError extends AppError {
  constructor(offerId: string) {
    super('OFFER_CHANGED', `Offer changed meanwhile: ${offerId}`, 409);
  }
}

/** Pausar/retomar/parar fora do estado que a ação exige (ex.: retomar oferta que não está pausada). */
export class OfferInvalidStateError extends AppError {
  constructor(offerId: string, status: string) {
    super('OFFER_INVALID_STATE', `Offer ${offerId} is ${status}`, 409, { status });
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

// ── Gerador v2 ───────────────────────────────────────────────────────────────

/** Link de afiliado de outra conta (tag/etiqueta ≠ credencial do tenant). Nunca carrega a tag. */
export class OfferLinkNotOwnedError extends AppError {
  constructor(provider: string) {
    super('OFFER_LINK_NOT_OWNED', `Affiliate link belongs to another account on ${provider}`, 422, { provider });
  }
}

/** Link sem identificação de afiliado (sem `tag` na Amazon, sem `matt_word` no ML). */
export class OfferLinkNotAffiliateError extends AppError {
  constructor(provider: string) {
    super('OFFER_LINK_NOT_AFFILIATE', `Link has no affiliate identifier on ${provider}`, 422, { provider });
  }
}

/** Gerador sem configuração (sessão + grupos) no envio. */
export class OfferConfigMissingError extends AppError {
  constructor() {
    super('OFFER_CONFIG_MISSING', 'Offer generator is not configured', 409);
  }
}

/** "Marcar todos" fora do plano (entitlement `mention_all_enabled` = false). */
export class OfferMentionAllUnavailableError extends PlanFeatureUnavailableError {
  constructor() {
    super('mention_all_enabled');
  }
}
