import { AppError } from '../AppError';

// ── Caçador de Ofertas (.specs/features/offer-hunter/design.md) ──────────────
// `meta` vai ao cliente: só números e códigos; nunca token, link nem texto da fonte.

/** Teto de ofertas garimpadas do dia (`offer_hunter_finds_per_day`) atingido. */
export class OfferHuntDailyLimitError extends AppError {
  constructor(limit: number) {
    super('OFFER_HUNT_DAILY_LIMIT', 'Daily hunted offers limit reached', 429, { limit });
  }
}

/** Guarda técnica de execuções por dia (não é limite de plano). */
export class OfferHuntRunThrottledError extends AppError {
  constructor(limit: number) {
    super('OFFER_HUNT_RUN_THROTTLED', 'Too many hunt runs today', 429, { limit });
  }
}

/** Teto de caçadas salvas por tenant. */
export class OfferHuntLimitReachedError extends AppError {
  constructor(limit: number) {
    super('OFFER_HUNT_LIMIT_REACHED', 'Offer hunt limit reached', 409, { limit });
  }
}

/** Sem grupo de destino em `offer_hunter_settings`. */
export class OfferHuntDestinationRequiredError extends AppError {
  constructor() {
    super('OFFER_HUNT_DESTINATION_REQUIRED', 'Offer hunter destination group required', 422);
  }
}

/** Catálogo da fonte indisponível (rede, 5xx, resposta inesperada). */
export class OfferHuntSourceUnavailableError extends AppError {
  constructor(paused: boolean) {
    super('OFFER_HUNT_SOURCE_UNAVAILABLE', 'Offer hunt source unavailable', 503, { paused });
  }
}

/** Caçada ou achado não existe no tenant. */
export class OfferHuntNotFoundError extends AppError {
  constructor(resource: 'hunt' | 'find' = 'hunt') {
    super('OFFER_HUNT_NOT_FOUND', `Offer ${resource} not found`, 404, { resource });
  }
}

/** Achado já decidido (enviado, dispensado ou em envio): aprovar/dispensar de novo não muda nada. */
export class OfferHuntFindInvalidStateError extends AppError {
  constructor(status: string) {
    super('OFFER_HUNT_FIND_INVALID_STATE', 'Offer hunt find already handled', 409, { status });
  }
}

/** Portão de audiência (`OFFER_HUNTER_AUDIENCE`): usuário/tenant fora da prévia ou sem o entitlement. */
export class OfferHunterUnavailableError extends AppError {
  constructor() {
    super('OFFER_HUNTER_UNAVAILABLE', 'Offer hunter is not available for this account', 403);
  }
}

/** Cursor de página (execuções/achados) inválido, adulterado, de outra caçada ou expirado. */
export class OfferHuntCursorInvalidError extends AppError {
  constructor() {
    super('OFFER_HUNT_CURSOR_INVALID', 'Offer hunt page cursor is invalid or expired, reload the list', 400, { field: 'cursor' });
  }
}
