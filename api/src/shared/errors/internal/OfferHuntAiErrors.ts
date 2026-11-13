import { AppError } from '../AppError';

// ── IA que configura a caçada (.specs/features/offer-hunter-multi, AI-01..06) ──
// `meta` vai ao cliente: só números e códigos; nunca intenção, prompt nem resposta da IA.

/** Teto técnico de sugestões de IA por conta/dia (`HUNTER_AI_LIMITS.aiSuggestionsPerDayMax`). */
export class OfferHuntAiSuggestDailyLimitError extends AppError {
  constructor(limit: number) {
    super('OFFER_HUNT_AI_SUGGEST_DAILY_LIMIT', 'Daily AI hunt suggestions limit reached', 429, { limit });
  }
}

/** Sem intenção e sem "IA escolhe o produto": nada para a IA decidir. */
export class OfferHuntAiSuggestInputRequiredError extends AppError {
  constructor() {
    super('OFFER_HUNT_AI_SUGGEST_INPUT_REQUIRED', 'Provide an intent or let the AI pick the product', 422, { field: 'intent' });
  }
}

/** A IA respondeu fora do formato ou sem nenhum campo aproveitável (conta como sugestão usada). */
export class OfferHuntAiSuggestInvalidOutputError extends AppError {
  constructor() {
    super('OFFER_HUNT_AI_SUGGEST_INVALID_OUTPUT', 'AI suggestion could not be used, configure the hunt manually', 422);
  }
}

/** Marca sem capacidades registradas no servidor (registry do caçador ainda sem a marca). */
export class OfferHuntAiSuggestProviderUnavailableError extends AppError {
  constructor(provider: string) {
    super('OFFER_HUNT_AI_SUGGEST_PROVIDER_UNAVAILABLE', 'Hunt provider not available for AI suggestions', 503, { provider });
  }
}
